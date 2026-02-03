import prompts from "prompts";
import kleur from "kleur";
import fs from "fs-extra";
import execa from "execa";
import { loadRegistry } from "../config/registry";
import { executeSteps } from "../executor/runner";

const OKIT_BIN_PATH = "/usr/local/bin/okit";
const OKIT_DOWNLOAD_URL = "https://github.com/yourname/okit/releases/latest/download/okit-macos";

export async function showUpgradeMenu(): Promise<void> {
  console.log(kleur.cyan("\n⬆️  Upgrade\n"));

  const response = await prompts({
    type: "select",
    name: "action",
    message: "选择操作",
    choices: [
      { title: "Upgrade OKIT itself", value: "self" },
      { title: "Upgrade all tools", value: "tools" },
      { title: "Back", value: "back" },
    ],
  });

  switch (response.action) {
    case "self":
      await upgradeSelf();
      break;
    case "tools":
      await upgradeTools();
      break;
    case "back":
    default:
      return;
  }
}

async function upgradeSelf(): Promise<void> {
  console.log(kleur.cyan("\n⬆️  Upgrading OKIT...\n"));

  try {
    // 检查是否有写权限
    if (!(await fs.pathExists(OKIT_BIN_PATH))) {
      console.log(kleur.red(`✗ OKIT 未安装在 ${OKIT_BIN_PATH}`));
      return;
    }

    const canWrite = await checkWritePermission(OKIT_BIN_PATH);
    if (!canWrite) {
      console.log(kleur.yellow("⚠️  需要管理员权限来升级 OKIT"));
      console.log(kleur.gray("请运行: sudo okit upgrade"));
      return;
    }

    // 下载最新版本
    console.log(kleur.gray("Downloading latest version..."));

    if (await fs.pathExists("./bin/okit-macos")) {
      // 开发环境：使用本地构建
      console.log(kleur.gray("Using local build..."));
      await fs.copy("./bin/okit-macos", OKIT_BIN_PATH);
    } else {
      // 生产环境：从 GitHub 下载
      await execa.command(`curl -fsSL -o ${OKIT_BIN_PATH} ${OKIT_DOWNLOAD_URL}`, {
        shell: true,
      });
    }

    await fs.chmod(OKIT_BIN_PATH, 0o755);

    console.log(kleur.green("✓ OKIT upgraded successfully!"));
    console.log(kleur.gray("Please restart your terminal."));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(kleur.red(`✗ Upgrade failed: ${message}`));
  }
}

async function upgradeTools(): Promise<void> {
  const registry = await loadRegistry();
  const upgradableSteps = registry.steps.filter((s) => s.upgrade);

  if (upgradableSteps.length === 0) {
    console.log(kleur.yellow("没有可升级的工具"));
    return;
  }

  console.log(
    kleur.cyan(`\n⬆️  Upgrading all tools (${upgradableSteps.length})\n`)
  );

  const results = await executeSteps(upgradableSteps, "upgrade", registry);

  const { printResults } = await import("../executor/runner");
  printResults(results);
}

async function checkWritePermission(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
