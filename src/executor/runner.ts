import execa from "execa";
import fs from "fs-extra";
import path from "path";
import { Step, Registry } from "../config/registry";
import { LOGS_DIR } from "../config/registry";
import kleur from "kleur";
import ora from "ora";
import { t } from "../config/i18n";
import { playSound } from "../utils/sound";
import { ExecutionPlanner } from "./plan/ExecutionPlanner";
import { getAllDependencies } from "./plan/registryDeps";

export interface ExecuteResult {
  step: Step;
  action: "install" | "upgrade" | "uninstall" | "skip";
  success: boolean;
  message?: string;
  duration?: number; // 执行耗时（毫秒）
}

export async function checkStep(step: Step): Promise<boolean> {
  if (!step.check) return false;

  try {
    await execa.command(step.check, { shell: true });
    return true;
  } catch {
    return false;
  }
}

function isBrewDependencyError(message: string): boolean {
  return /Refusing to uninstall/i.test(message) && /required by/i.test(message);
}

// 检查并安装依赖
async function checkAndInstallDependencies(
  step: Step,
  registry: Registry,
  installedSteps: Set<string>,
  results: ExecuteResult[]
): Promise<boolean> {
  if (!step.dependencies || step.dependencies.length === 0) {
    return true;
  }

  const deps = getAllDependencies(step, registry);
  const missingDeps: Step[] = [];

  // 检查哪些依赖未安装
  for (const dep of deps) {
    if (installedSteps.has(dep.name)) continue;

    const exists = await checkStep(dep);
    if (!exists) {
      missingDeps.push(dep);
    } else {
      installedSteps.add(dep.name);
    }
  }

  if (missingDeps.length === 0) {
    return true;
  }

  // 显示依赖信息
  console.log(kleur.cyan(`\n📦 ${step.name} ${t("requiresDeps")}:`));
  missingDeps.forEach((dep) => {
    console.log(kleur.gray(`   - ${dep.name}`));
  });
  console.log();

  // 自动安装缺失的依赖
  for (const dep of missingDeps) {
    console.log(kleur.yellow(`⬆️  ${t("installingDep")}: ${dep.name}`));
    const result = await executeStep(dep, "install", registry, installedSteps, results, true);
    results.push(result);

    if (!result.success) {
      console.log(kleur.red(`\n✗ ${t("depInstallFailed")}: ${dep.name}`));
      return false;
    }
    installedSteps.add(dep.name);
  }

  return true;
}

export async function executeStep(
  step: Step,
  action: "install" | "upgrade" | "uninstall",
  registry?: Registry,
  installedSteps?: Set<string>,
  allResults?: ExecuteResult[],
  isDependency: boolean = false
): Promise<ExecuteResult> {
  let command: string | undefined;
  if (action === "install") command = step.install;
  else if (action === "upgrade") command = step.upgrade;
  else if (action === "uninstall") command = step.uninstall;

  if (!command) {
    return {
      step,
      action,
      success: false,
      message: `No ${action} command`,
    };
  }

  // 检查并安装依赖（仅在安装/升级时）
  if ((action === "install" || action === "upgrade") && registry && allResults) {
    const depsOk = await checkAndInstallDependencies(step, registry, installedSteps || new Set(), allResults);
    if (!depsOk) {
      return {
        step,
        action,
        success: false,
        message: t("depsNotSatisfied"),
      };
    }
  }

  // 检查命令是否可能需要 sudo
  const mayNeedSudo =
    command.includes("brew install") ||
    command.includes("brew upgrade") ||
    command.includes("brew uninstall") ||
    command.includes("sudo npm");

  if (mayNeedSudo && !isDependency) {
    console.log(kleur.yellow(`\n⚠️  ${step.name} ${t("mayNeedSudo")}`));
    console.log(kleur.gray(t("enterPassword") + "\n"));
    // 播放输入提示音，提醒用户需要输入
    playSound("input");
  }

  const spinner = ora(`${step.name} - ${action}...`).start();
  const startTime = Date.now();

  try {
    if (action === "uninstall") {
      const skipReason = await getUninstallSkipReason(step, command);
      if (skipReason) {
        spinner.succeed(`${step.name} ${skipReason}`);
        return {
          step,
          action: "skip",
          success: true,
          duration: Date.now() - startTime,
        };
      }
    }

    // 如果是 install，先检查是否已存在
    if (action === "install" && step.check) {
      const exists = await checkStep(step);
      if (exists) {
        spinner.succeed(`${step.name} ${t("alreadyExists")}`);
        return {
          step,
          action: "skip",
          success: true,
          duration: Date.now() - startTime,
        };
      }
    }

    // 停止 spinner，让用户可以看到命令输出和输入密码
    spinner.stop();
    if (!isDependency) {
      console.log(kleur.gray(`> ${command}`));
    }

    await execa.command(command, {
      shell: true,
      stdio: "inherit",
    });

    const duration = Date.now() - startTime;
    if (!isDependency) {
      console.log(kleur.green(`✓ ${step.name} ${action} ${t("successMsg")}`));
    }
    return {
      step,
      action,
      success: true,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    if (!isDependency) {
      console.log(kleur.red(`✗ ${step.name} ${action} ${t("failedMsg")}: ${message}`));
      if (action === "uninstall" && isBrewDependencyError(message)) {
        console.log(kleur.yellow(t("uninstallDepsHint")));
      }
    }
    return {
      step,
      action,
      success: false,
      message,
      duration,
    };
  }
}

async function getUninstallSkipReason(step: Step, command: string): Promise<string | null> {
  const brewTarget = parseBrewUninstallTarget(command);
  if (brewTarget) {
    const installed = await isBrewPackageInstalled(brewTarget.name, brewTarget.isCask);
    if (!installed) return t("notInstalled");
    return null;
  }

  const pipxTarget = parsePipxUninstallTarget(command);
  if (pipxTarget) {
    const installed = await isPipxPackageInstalled(pipxTarget);
    if (!installed) return t("notInstalled");
    return null;
  }

  const uvToolTarget = parseUvToolUninstallTarget(command);
  if (uvToolTarget) {
    const installed = await isUvToolInstalled(uvToolTarget);
    if (!installed) return t("notInstalled");
    return null;
  }

  return null;
}

function parseBrewUninstallTarget(command: string): { name: string; isCask: boolean } | null {
  const segment = command.split("&&")[0]?.trim() ?? "";
  const tokens = segment.split(/\s+/).filter(Boolean);
  const brewIndex = tokens.indexOf("brew");
  if (brewIndex < 0) return null;
  const uninstallIndex = tokens.indexOf("uninstall", brewIndex + 1);
  if (uninstallIndex < 0) return null;

  let isCask = false;
  for (let i = uninstallIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--cask") {
      isCask = true;
      continue;
    }
    if (token.startsWith("-")) continue;
    return { name: token, isCask };
  }
  return null;
}

function parsePipxUninstallTarget(command: string): string | null {
  const segment = command.split("&&")[0]?.trim() ?? "";
  const tokens = segment.split(/\s+/).filter(Boolean);
  const pipxIndex = tokens.indexOf("pipx");
  if (pipxIndex < 0) return null;
  const uninstallIndex = tokens.findIndex(
    (token, index) => index > pipxIndex && token === "uninstall"
  );
  if (uninstallIndex < 0) return null;
  for (let i = uninstallIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("-")) continue;
    return token;
  }
  return null;
}

function parseUvToolUninstallTarget(command: string): string | null {
  const segment = command.split("&&")[0]?.trim() ?? "";
  const tokens = segment.split(/\s+/).filter(Boolean);
  const uvIndex = tokens.indexOf("uv");
  if (uvIndex < 0) return null;
  const toolIndex = tokens.findIndex((token, index) => index > uvIndex && token === "tool");
  if (toolIndex < 0) return null;
  const uninstallIndex = tokens.findIndex(
    (token, index) => index > toolIndex && token === "uninstall"
  );
  if (uninstallIndex < 0) return null;
  for (let i = uninstallIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("-")) continue;
    return token;
  }
  return null;
}

async function isBrewPackageInstalled(name: string, isCask: boolean): Promise<boolean> {
  try {
    if (isCask) {
      const { stdout } = await execa.command(`brew list --cask ${name}`, {
        shell: true,
      });
      return stdout.trim().length > 0;
    }
    const { stdout } = await execa.command(`brew list --versions ${name}`, {
      shell: true,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function isPipxPackageInstalled(name: string): Promise<boolean> {
  try {
    const { stdout } = await execa.command("pipx list --json", { shell: true });
    const data = JSON.parse(stdout);
    if (data && data.venvs && typeof data.venvs === "object") {
      return Boolean(data.venvs[name]);
    }
    if (data && data.packages && typeof data.packages === "object") {
      return Boolean(data.packages[name]);
    }
    return stdout.includes(`"${name}"`);
  } catch {
    return false;
  }
}

async function isUvToolInstalled(name: string): Promise<boolean> {
  try {
    const { stdout } = await execa.command("uv tool list", { shell: true });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .some((line) => line.startsWith(`${name} `) || line === name);
  } catch {
    return false;
  }
}

export async function executeSteps(
  steps: Step[],
  action: "install" | "upgrade" | "uninstall",
  registry?: Registry
): Promise<ExecuteResult[]> {
  const results: ExecuteResult[] = [];
  const installedSteps = new Set<string>();
  let orderedSteps = steps;
  let addedDeps = new Set<string>();
  let externalDependents = new Map<string, string[]>();
  let missingDeps = new Map<string, string[]>();

  if (registry) {
    const planSpinner = ora(t("planPreparing")).start();
    const plan = await ExecutionPlanner.build(steps, action, registry);
    planSpinner.succeed(t("planPrepared"));
    orderedSteps = plan.ordered;
    addedDeps = plan.addedDeps;
    externalDependents = plan.externalDependents;
    missingDeps = plan.missingDeps;
  }

  if (orderedSteps.length > 0) {
    console.log(kleur.cyan("\n" + t("planTitle")));
    orderedSteps.forEach((step, index) => {
      const isDep = addedDeps.has(step.name);
      const depLabel = isDep ? ` ${t("planDepMark")}` : "";
      console.log(`${String(index + 1).padStart(2, " ")}. ${step.name}${depLabel}`);
    });
    console.log();
  }

  if (action === "uninstall" && externalDependents.size > 0) {
    console.log(kleur.yellow(t("externalDepsTitle")));
    for (const [stepName, deps] of externalDependents.entries()) {
      console.log(kleur.gray(`- ${stepName}: ${deps.join(", ")}`));
    }
    console.log(kleur.gray(t("externalDepsHint")));
    console.log();
  }

  if (missingDeps.size > 0) {
    console.log(kleur.yellow(t("missingDepsTitle")));
    for (const [stepName, deps] of missingDeps.entries()) {
      console.log(kleur.gray(`- ${stepName}: ${deps.join(", ")}`));
    }
    console.log(kleur.gray(t("missingDepsHint")));
    console.log();
  }

  for (const step of orderedSteps) {
    const result = await executeStep(step, action, registry, installedSteps, results);
    results.push(result);
    if (result.success && action === "install") {
      installedSteps.add(step.name);
    }
  }

  return results;
}

// 格式化时长
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function printResults(results: ExecuteResult[]) {
  console.log(kleur.cyan("\n" + "═".repeat(60)));
  console.log(kleur.bold(kleur.cyan(t("reportTitle"))));
  console.log(kleur.cyan("═".repeat(60) + "\n"));

  const success = results.filter((r) => r.success && r.action !== "skip");
  const failed = results.filter((r) => !r.success);
  const skipped = results.filter((r) => r.action === "skip");

  // 详细列表 - 使用简单格式避免中文对齐问题
  console.log(kleur.bold(`  ${t("status")}    ${t("toolName")}              ${t("operation")}      ${t("duration")}`));
  console.log(kleur.gray("  " + "-".repeat(50)));

  results.forEach((r) => {
    const status = r.success
      ? r.action === "skip"
        ? kleur.yellow("⏸ " + t("skipped"))
        : kleur.green("✓ " + t("success"))
      : kleur.red("✗ " + t("failed"));
    const actionText = r.action === "skip" ? "-" : r.action;
    const duration = r.duration ? formatDuration(r.duration) : "-";

    console.log(
      `  ${status}  ${r.step.name.padEnd(20)} ${actionText.padEnd(9)} ${duration}`
    );
  });

  console.log();

  // 统计摘要
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);

  console.log(kleur.bold(t("summary")));
  console.log(`  ${kleur.green("●")} ${t("success")}: ${success.length}`);
  console.log(`  ${kleur.red("●")} ${t("failed")}: ${failed.length}`);
  console.log(`  ${kleur.yellow("●")} ${t("skipped")}: ${skipped.length}`);
  console.log(`  ${kleur.cyan("●")} ${t("total")}: ${results.length}`);
  console.log(`  ${kleur.cyan("●")} ${t("totalDuration")}: ${formatDuration(totalDuration)}`);
  console.log();

  if (failed.length > 0) {
    console.log(kleur.red(t("failedTools")));
    failed.forEach((r) => {
      console.log(`  - ${r.step.name}: ${r.message}`);
    });
    console.log();
    // 有失败时播放警告提示音
    playSound("warning");
  } else if (success.length > 0) {
    // 全部成功时播放成功提示音
    playSound("success");
  }

  console.log(kleur.gray(t("retryHint")));

  writeLatestLog(results).catch(() => {});
}

async function writeLatestLog(results: ExecuteResult[]): Promise<void> {
  const payload = {
    generatedAt: new Date().toISOString(),
    results: results.map((r) => ({
      name: r.step.name,
      action: r.action,
      success: r.success,
      message: r.message,
      duration: r.duration,
    })),
  };
  await fs.ensureDir(LOGS_DIR);
  const filePath = path.join(LOGS_DIR, "latest.json");
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
}
