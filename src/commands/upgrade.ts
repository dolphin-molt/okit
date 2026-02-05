import prompts from "prompts";
import kleur from "kleur";
import fs from "fs-extra";
import os from "os";
import path from "path";
import execa from "execa";
import { loadRegistry } from "../config/registry";
import { executeSteps } from "../executor/runner";

const OKIT_REPO = "dolphin-molt/okit";
const OKIT_BIN_PATH = "/usr/local/bin/okit";

export async function showUpgradeMenu(): Promise<void> {
  console.log(kleur.cyan("\n⬆️  Upgrade\n"));

  while (true) {
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
}

export async function upgradeSelf(): Promise<void> {
  console.log(kleur.cyan("\n⬆️  Upgrading OKIT...\n"));

  try {
    // 检查是否有写权限
    if (!(await fs.pathExists(OKIT_BIN_PATH))) {
      console.log(kleur.red(`✗ OKIT 未安装在 ${OKIT_BIN_PATH}`));
      return;
    }

    const canWrite = await checkWritePermission(OKIT_BIN_PATH);
    let useSudo = false;
    if (!canWrite) {
      console.log(kleur.yellow("⚠️  需要管理员权限来升级 OKIT"));
      const sudoResponse = await prompts({
        type: "confirm",
        name: "confirm",
        message: "是否现在使用 sudo 升级？",
        initial: true,
      });
      if (!sudoResponse.confirm) {
        console.log(kleur.gray("请运行: sudo okit upgrade"));
        return;
      }
      useSudo = true;
    }

    // 下载最新版本
    console.log(kleur.gray("Downloading latest version..."));

    if (await fs.pathExists("./bin/okit-macos")) {
      // 开发环境：使用本地构建
      console.log(kleur.gray("Using local build..."));
      await fs.copy("./bin/okit-macos", OKIT_BIN_PATH);
    } else {
      const downloadUrl = await resolveLatestAssetUrl();
      if (!downloadUrl) {
        throw new Error("Failed to resolve download URL");
      }
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "okit-upgrade-"));
      const zipPath = path.join(tmpDir, "okit.zip");
      await execa.command(`curl -fsSL -o "${zipPath}" "${downloadUrl}"`, { shell: true });
      try {
        await execa.command(`unzip -q "${zipPath}" -d "${tmpDir}"`, { shell: true });
      } catch {
        await execa.command(`ditto -xk "${zipPath}" "${tmpDir}"`, { shell: true });
      }
      const binPath = path.join(tmpDir, "okit");
      if (!(await fs.pathExists(binPath))) {
        throw new Error("Missing okit binary in release asset");
      }
      if (useSudo) {
        await execa.command(`sudo cp "${binPath}" "${OKIT_BIN_PATH}"`, {
          shell: true,
          stdio: "inherit",
        });
      } else {
        await fs.copy(binPath, OKIT_BIN_PATH);
      }
    }

    if (useSudo) {
      await execa.command(`sudo chmod 755 "${OKIT_BIN_PATH}"`, {
        shell: true,
        stdio: "inherit",
      });
    } else {
      await fs.chmod(OKIT_BIN_PATH, 0o755);
    }

    console.log(kleur.green("✓ OKIT upgraded successfully!"));
    console.log(kleur.gray("Please restart your terminal."));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(kleur.red(`✗ Upgrade failed: ${message}`));
  }
}

export async function upgradeTools(): Promise<void> {
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

async function resolveLatestAssetUrl(): Promise<string | null> {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : "";
  if (!arch) {
    console.log(kleur.red(`✗ 不支持的架构: ${process.arch}`));
    return null;
  }

  try {
    const { stdout } = await execa.command(
      `curl -s https://api.github.com/repos/${OKIT_REPO}/releases/latest`,
      { shell: true }
    );
    const data = JSON.parse(stdout);
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const tag = typeof data.tag_name === "string" ? data.tag_name : "";
    const assetName = tag ? `okit-${tag}-macos-${arch}.zip` : "";
    if (!assetName) return null;
    const asset = assets.find((a: any) => a && a.name === assetName);
    return asset?.browser_download_url ?? null;
  } catch {
    return null;
  }
}
