import execa from "execa";
import kleur from "kleur";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { loadRegistry, Step, LOGS_DIR } from "../config/registry";
import { checkStep } from "../executor/runner";
import { t } from "../config/i18n";

export interface CheckResult {
  name: string;
  installed: boolean;
  version?: string;
  outdated?: boolean;
  availableVersion?: string;
  authOk?: boolean;    // null = no auth check, true/false = result
  authMsg?: string;
}

// 获取工具版本
async function getVersion(step: Step): Promise<string | undefined> {
  if (!step.versionCmd) return undefined;
  try {
    const { stdout } = await execa.command(step.versionCmd, {
      shell: true,
      timeout: 10000,
    });
    return stdout.trim().replace(/\n.*/s, "");
  } catch {
    return undefined;
  }
}

// 检查授权状态
async function checkAuth(step: Step): Promise<{ ok: boolean; msg: string } | undefined> {
  if (!step.authCheck) return undefined;
  try {
    const { stdout, stderr } = await execa.command(step.authCheck, {
      shell: true,
      timeout: 15000,
    });
    const output = (stdout + "\n" + stderr).trim();
    // gh auth status 成功退出 = 已登录
    // docker info 成功 = daemon 运行中
    return { ok: true, msg: output.split("\n")[0] };
  } catch (error: any) {
    const output = ((error.stdout || "") + "\n" + (error.stderr || "")).trim();
    return { ok: false, msg: output.split("\n")[0] || "auth check failed" };
  }
}

// 获取 brew outdated 信息
async function getBrewOutdated(): Promise<Map<string, string>> {
  const outdated = new Map<string, string>();
  try {
    const { stdout } = await execa.command("brew outdated --json=v2", {
      shell: true,
      timeout: 30000,
    });
    const data = JSON.parse(stdout);
    // formulae
    for (const pkg of data.formulae || []) {
      const current = pkg.installed_versions?.[0] || "";
      const latest = pkg.current_version || "";
      if (latest && latest !== current) {
        outdated.set(pkg.name, latest);
      }
    }
    // casks
    for (const pkg of data.casks || []) {
      const latest = pkg.current_version || "";
      if (latest) {
        outdated.set(pkg.name, latest);
      }
    }
  } catch {
    // brew outdated 失败不影响其他检查
  }
  return outdated;
}

// 从 install 命令中提取 brew 包名
function extractBrewName(step: Step): string | undefined {
  const cmd = step.install;
  // 匹配 brew install [--cask] <name>
  const match = cmd.match(/brew install\s+(?:--cask\s+)?(\S+)/);
  return match?.[1];
}

// 获取 npm -g outdated 信息
async function getNpmOutdated(): Promise<Map<string, string>> {
  const outdated = new Map<string, string>();
  try {
    const { stdout } = await execa.command("npm outdated -g --json 2>/dev/null || true", {
      shell: true,
      timeout: 30000,
    });
    if (stdout.trim()) {
      const data = JSON.parse(stdout);
      for (const [name, info] of Object.entries(data) as any) {
        if (info.latest) {
          outdated.set(name, info.latest);
        }
      }
    }
  } catch {
    // npm outdated 失败不影响其他检查
  }
  return outdated;
}

// 从 install 命令中提取 npm 包名
function extractNpmPackage(step: Step): string | undefined {
  const cmd = step.install;
  // 匹配 npm install -g <pkg> 或 sudo npm install -g <pkg>
  const match = cmd.match(/npm install\s+-g\s+(\S+)/);
  return match?.[1];
}

export async function runCheck(options: { json?: boolean } = {}): Promise<CheckResult[]> {
  const spinner = ora(t("checkScanning")).start();

  const registry = await loadRegistry();
  const steps = registry.steps;
  const results: CheckResult[] = [];

  // 并行获取 brew 和 npm 的过期信息
  const [brewOutdated, npmOutdated] = await Promise.all([
    getBrewOutdated(),
    getNpmOutdated(),
  ]);

  spinner.text = t("checkRunning");

  // 逐个检查工具
  for (const step of steps) {
    const installed = await checkStep(step);

    if (!installed) {
      results.push({ name: step.name, installed: false });
      continue;
    }

    const result: CheckResult = { name: step.name, installed: true };

    // 版本
    result.version = await getVersion(step);

    // 是否有更新
    const brewName = extractBrewName(step);
    const npmPkg = extractNpmPackage(step);
    if (brewName && brewOutdated.has(brewName)) {
      result.outdated = true;
      result.availableVersion = brewOutdated.get(brewName);
    } else if (npmPkg && npmOutdated.has(npmPkg)) {
      result.outdated = true;
      result.availableVersion = npmOutdated.get(npmPkg);
    } else {
      result.outdated = false;
    }

    // 授权检查
    const auth = await checkAuth(step);
    if (auth) {
      result.authOk = auth.ok;
      result.authMsg = auth.msg;
    }

    results.push(result);
  }

  spinner.stop();

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printCheckReport(results);
  }

  // 保存检查结果日志
  await saveCheckLog(results);

  return results;
}

function printCheckReport(results: CheckResult[]) {
  const installed = results.filter((r) => r.installed);
  const notInstalled = results.filter((r) => !r.installed);
  const outdated = results.filter((r) => r.outdated);
  const authFailed = results.filter((r) => r.authOk === false);

  console.log(kleur.cyan("\n" + "═".repeat(60)));
  console.log(kleur.bold(kleur.cyan(t("checkReportTitle"))));
  console.log(kleur.cyan("═".repeat(60) + "\n"));

  // 已安装的工具
  if (installed.length > 0) {
    console.log(kleur.bold(kleur.green(`  ✓ ${t("checkInstalled")} (${installed.length})`)));
    for (const r of installed) {
      const version = r.version ? kleur.gray(` ${r.version}`) : "";
      const update = r.outdated
        ? kleur.yellow(` → ${r.availableVersion}`)
        : "";
      const auth = r.authOk === false
        ? kleur.red(` [${t("checkAuthFailed")}]`)
        : r.authOk === true
          ? kleur.green(` [${t("checkAuthOk")}]`)
          : "";
      console.log(`    ${r.name}${version}${update}${auth}`);
    }
    console.log();
  }

  // 未安装的工具
  if (notInstalled.length > 0) {
    console.log(kleur.bold(kleur.gray(`  ○ ${t("checkNotInstalled")} (${notInstalled.length})`)));
    for (const r of notInstalled) {
      console.log(kleur.gray(`    ${r.name}`));
    }
    console.log();
  }

  // 需要升级的工具
  if (outdated.length > 0) {
    console.log(kleur.bold(kleur.yellow(`  ⬆ ${t("checkOutdated")} (${outdated.length})`)));
    for (const r of outdated) {
      console.log(kleur.yellow(`    ${r.name} ${r.version || "?"} → ${r.availableVersion}`));
    }
    console.log();
  }

  // 授权失败的工具
  if (authFailed.length > 0) {
    console.log(kleur.bold(kleur.red(`  ⚠ ${t("checkAuthIssues")} (${authFailed.length})`)));
    for (const r of authFailed) {
      console.log(kleur.red(`    ${r.name}: ${r.authMsg}`));
    }
    console.log();
  }

  // 总结
  console.log(kleur.bold(t("checkSummary")));
  console.log(`  ${kleur.green("●")} ${t("checkInstalled")}: ${installed.length}/${results.length}`);
  if (outdated.length > 0) {
    console.log(`  ${kleur.yellow("●")} ${t("checkOutdated")}: ${outdated.length}`);
  }
  if (authFailed.length > 0) {
    console.log(`  ${kleur.red("●")} ${t("checkAuthIssues")}: ${authFailed.length}`);
  }

  // 健康评分
  const score = Math.round(
    ((installed.length / results.length) * 70) +
    ((1 - outdated.length / Math.max(installed.length, 1)) * 20) +
    ((1 - authFailed.length / Math.max(installed.length, 1)) * 10)
  );
  const scoreColor = score >= 80 ? kleur.green : score >= 60 ? kleur.yellow : kleur.red;
  console.log(`  ${scoreColor("●")} ${t("checkHealthScore")}: ${scoreColor(String(score) + "/100")}`);
  console.log();

  // 建议
  if (outdated.length > 0) {
    console.log(kleur.gray(`  ${t("checkHintUpgrade")}`));
  }
  if (authFailed.length > 0) {
    console.log(kleur.gray(`  ${t("checkHintAuth")}`));
  }
  if (notInstalled.length > 0 && installed.length < results.length * 0.5) {
    console.log(kleur.gray(`  ${t("checkHintInstall")}`));
  }
  console.log();
}

async function saveCheckLog(results: CheckResult[]): Promise<void> {
  try {
    await fs.ensureDir(LOGS_DIR);
    const payload = {
      generatedAt: new Date().toISOString(),
      results,
    };
    await fs.writeFile(
      path.join(LOGS_DIR, "check-latest.json"),
      JSON.stringify(payload, null, 2)
    );
  } catch {
    // 日志写入失败不影响主流程
  }
}
