import kleur from "kleur";
import execa from "execa";

const PACKAGE_NAME = "okit-cli";

export async function upgradeSelf(): Promise<void> {
  console.log(kleur.cyan("\n⬆️  Upgrading OKIT...\n"));

  try {
    // 检查当前版本
    const pkg = await import("../../package.json");
    const currentVersion = pkg.version;
    console.log(kleur.gray(`当前版本: ${currentVersion}`));

    // 查询 NPM 最新版本
    let latestVersion: string | undefined;
    try {
      const { stdout } = await execa.command(`npm view ${PACKAGE_NAME} version`, { shell: true });
      latestVersion = stdout.trim();
    } catch {
      console.log(kleur.yellow("⚠️  无法查询 NPM 最新版本"));
    }

    if (latestVersion && latestVersion === currentVersion) {
      console.log(kleur.green("✓ 已是最新版本"));
      return;
    }

    if (latestVersion) {
      console.log(kleur.gray(`最新版本: ${latestVersion}`));
    }

    // 通过 npm 升级
    console.log(kleur.gray(`正在升级 ${PACKAGE_NAME}...`));
    await execa.command(`npm update -g ${PACKAGE_NAME}`, {
      shell: true,
      stdio: "inherit",
    });

    console.log(kleur.green("✓ OKIT 升级成功"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 如果普通升级失败，提示 sudo
    if (message.includes("EACCES") || message.includes("permission")) {
      console.log(kleur.yellow("⚠️  权限不足，尝试 sudo 升级..."));
      try {
        await execa.command(`sudo npm update -g ${PACKAGE_NAME}`, {
          shell: true,
          stdio: "inherit",
        });
        console.log(kleur.green("✓ OKIT 升级成功"));
        return;
      } catch (sudoError) {
        const sudoMsg = sudoError instanceof Error ? sudoError.message : String(sudoError);
        console.log(kleur.red(`✗ 升级失败: ${sudoMsg}`));
        return;
      }
    }
    console.log(kleur.red(`✗ 升级失败: ${message}`));
  }
}
