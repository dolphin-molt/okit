import execa from "execa";
import kleur from "kleur";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { loadRegistry, Step, LOGS_DIR, resolveCmd } from "../config/registry";
import { checkStep } from "../executor/runner";
import { t, getLanguage } from "../config/i18n";
import {
  parseSemVer,
  compareVersions,
  upgradeLevelLabel,
  upgradeAdvice,
  UpgradeLevel,
} from "../utils/semver";

export interface CheckResult {
  name: string;
  installed: boolean;
  version?: string;
  outdated?: boolean;
  availableVersion?: string;
  upgradeLevel?: UpgradeLevel;
  authOk?: boolean;
  authMsg?: string;
}

// 获取工具版本
async function getVersion(step: Step): Promise<string | undefined> {
  const cmd = resolveCmd(step.versionCmd);
  if (!cmd) return undefined;
  try {
    const { stdout } = await execa.command(cmd, {
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
  const cmd = resolveCmd(step.authCheck);
  if (!cmd) return undefined;
  try {
    const { stdout, stderr } = await execa.command(cmd, {
      shell: true,
      timeout: 15000,
    });
    const output = (stdout + "\n" + stderr).trim();
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
    for (const pkg of data.formulae || []) {
      const current = pkg.installed_versions?.[0] || "";
      const latest = pkg.current_version || "";
      if (latest && latest !== current) {
        outdated.set(pkg.name, latest);
      }
    }
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
  const install = resolveCmd(step.install);
  if (!install) return undefined;
  const match = install.match(/brew install\s+(?:--cask\s+)?(\S+)/);
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
  const install = resolveCmd(step.install);
  if (!install) return undefined;
  const match = install.match(/npm install\s+-g\s+(\S+)/);
  return match?.[1];
}

// 计算升级级别
function assessUpgradeLevel(version?: string, availableVersion?: string): UpgradeLevel | undefined {
  if (!version || !availableVersion) return undefined;
  const current = parseSemVer(version);
  const available = parseSemVer(availableVersion);
  if (!current || !available) return "unknown";
  return compareVersions(current, available);
}

export async function runCheck(options: { json?: boolean } = {}): Promise<CheckResult[]> {
  const spinner = ora(t("checkScanning")).start();

  const registry = await loadRegistry();
  const steps = registry.steps;
  const results: CheckResult[] = [];

  const [brewOutdated, npmOutdated] = await Promise.all([
    getBrewOutdated(),
    getNpmOutdated(),
  ]);

  spinner.text = t("checkRunning");

  for (const step of steps) {
    const installed = await checkStep(step);

    if (!installed) {
      results.push({ name: step.name, installed: false });
      continue;
    }

    const result: CheckResult = { name: step.name, installed: true };

    result.version = await getVersion(step);

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

    // 升级评估
    if (result.outdated) {
      result.upgradeLevel = assessUpgradeLevel(result.version, result.availableVersion);
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

  await saveCheckLog(results);

  return results;
}

function levelColor(level: UpgradeLevel): (s: string) => string {
  switch (level) {
    case "patch": return kleur.green;
    case "minor": return kleur.yellow;
    case "major": return kleur.red;
    default: return kleur.gray;
  }
}

function levelIcon(level: UpgradeLevel): string {
  switch (level) {
    case "patch": return "●";
    case "minor": return "▲";
    case "major": return "⬆";
    default: return "?";
  }
}

function printCheckReport(results: CheckResult[]) {
  const lang = getLanguage();
  const installed = results.filter((r) => r.installed);
  const notInstalled = results.filter((r) => !r.installed);
  const outdated = results.filter((r) => r.outdated);
  const authFailed = results.filter((r) => r.authOk === false);

  // 按升级级别分组
  const majorUpgrades = outdated.filter((r) => r.upgradeLevel === "major");
  const minorUpgrades = outdated.filter((r) => r.upgradeLevel === "minor");
  const patchUpgrades = outdated.filter((r) => r.upgradeLevel === "patch");
  const unknownUpgrades = outdated.filter((r) => r.upgradeLevel === "unknown" || !r.upgradeLevel);

  console.log(kleur.cyan("\n" + "═".repeat(60)));
  console.log(kleur.bold(kleur.cyan(t("checkReportTitle"))));
  console.log(kleur.cyan("═".repeat(60) + "\n"));

  // 已安装的工具
  if (installed.length > 0) {
    console.log(kleur.bold(kleur.green(`  ✓ ${t("checkInstalled")} (${installed.length})`)));
    for (const r of installed) {
      const version = r.version ? kleur.gray(` ${r.version}`) : "";
      let update = "";
      if (r.outdated && r.upgradeLevel) {
        const color = levelColor(r.upgradeLevel);
        const label = upgradeLevelLabel(r.upgradeLevel, lang);
        update = color(` → ${r.availableVersion} [${label}]`);
      } else if (r.outdated) {
        update = kleur.yellow(` → ${r.availableVersion}`);
      }
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

  // 升级评估报告（按风险分组）
  if (outdated.length > 0) {
    console.log(kleur.bold(kleur.yellow(`  ⬆ ${t("checkUpgradeAssessment")} (${outdated.length})`)));
    console.log();

    if (patchUpgrades.length > 0) {
      console.log(kleur.green(`    ${levelIcon("patch")} ${t("checkPatchLevel")} (${patchUpgrades.length})`));
      console.log(kleur.gray(`      ${upgradeAdvice("patch", lang)}`));
      for (const r of patchUpgrades) {
        const cur = parseSemVer(r.version || "");
        const avail = parseSemVer(r.availableVersion || "");
        const curStr = cur ? `${cur.major}.${cur.minor}.${cur.patch}` : (r.version || "?");
        const availStr = avail ? `${avail.major}.${avail.minor}.${avail.patch}` : (r.availableVersion || "?");
        console.log(kleur.green(`      ${r.name} ${curStr} → ${availStr}`));
      }
      console.log();
    }

    if (minorUpgrades.length > 0) {
      console.log(kleur.yellow(`    ${levelIcon("minor")} ${t("checkMinorLevel")} (${minorUpgrades.length})`));
      console.log(kleur.gray(`      ${upgradeAdvice("minor", lang)}`));
      for (const r of minorUpgrades) {
        const cur = parseSemVer(r.version || "");
        const avail = parseSemVer(r.availableVersion || "");
        const curStr = cur ? `${cur.major}.${cur.minor}.${cur.patch}` : (r.version || "?");
        const availStr = avail ? `${avail.major}.${avail.minor}.${avail.patch}` : (r.availableVersion || "?");
        console.log(kleur.yellow(`      ${r.name} ${curStr} → ${availStr}`));
      }
      console.log();
    }

    if (majorUpgrades.length > 0) {
      console.log(kleur.red(`    ${levelIcon("major")} ${t("checkMajorLevel")} (${majorUpgrades.length})`));
      console.log(kleur.gray(`      ${upgradeAdvice("major", lang)}`));
      for (const r of majorUpgrades) {
        const cur = parseSemVer(r.version || "");
        const avail = parseSemVer(r.availableVersion || "");
        const curStr = cur ? `${cur.major}.${cur.minor}.${cur.patch}` : (r.version || "?");
        const availStr = avail ? `${avail.major}.${avail.minor}.${avail.patch}` : (r.availableVersion || "?");
        console.log(kleur.red(`      ${r.name} ${curStr} → ${availStr}`));
      }
      console.log();
    }

    if (unknownUpgrades.length > 0) {
      console.log(kleur.gray(`    ${levelIcon("unknown")} ${t("checkUnknownLevel")} (${unknownUpgrades.length})`));
      for (const r of unknownUpgrades) {
        console.log(kleur.gray(`      ${r.name} ${r.version || "?"} → ${r.availableVersion || "?"}`));
      }
      console.log();
    }
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
    const parts: string[] = [];
    if (patchUpgrades.length > 0) parts.push(kleur.green(`${patchUpgrades.length} ${t("checkPatchLevel")}`));
    if (minorUpgrades.length > 0) parts.push(kleur.yellow(`${minorUpgrades.length} ${t("checkMinorLevel")}`));
    if (majorUpgrades.length > 0) parts.push(kleur.red(`${majorUpgrades.length} ${t("checkMajorLevel")}`));
    if (unknownUpgrades.length > 0) parts.push(kleur.gray(`${unknownUpgrades.length} ${t("checkUnknownLevel")}`));
    console.log(`  ${kleur.yellow("●")} ${t("checkOutdated")}: ${outdated.length} (${parts.join(", ")})`);
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
  if (patchUpgrades.length > 0) {
    console.log(kleur.gray(`  ${t("checkHintPatch")}`));
  }
  if (minorUpgrades.length > 0 || majorUpgrades.length > 0) {
    console.log(kleur.gray(`  ${t("checkHintUpgrade")}`));
  }
  if (majorUpgrades.length > 0) {
    console.log(kleur.gray(`  ${t("checkHintMajor")}`));
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
