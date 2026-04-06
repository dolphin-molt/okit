import prompts from "prompts";
import kleur from "kleur";
import fs from "fs-extra";
import execa from "execa";
import { OKIT_DIR } from "../config/registry";

const PACKAGE_NAME = "okit-cli";

export async function uninstallOkit(): Promise<void> {
  console.log(kleur.cyan("\n🗑️  Uninstall OKIT\n"));

  const confirmResponse = await prompts({
    type: "confirm",
    name: "confirm",
    message: "确定要卸载 OKIT 吗？",
    initial: false,
  });

  if (!confirmResponse.confirm) {
    console.log(kleur.gray("已取消"));
    return;
  }

  try {
    // 通过 npm 卸载
    console.log(kleur.gray(`正在卸载 ${PACKAGE_NAME}...`));
    try {
      await execa.command(`npm uninstall -g ${PACKAGE_NAME}`, {
        shell: true,
        stdio: "inherit",
      });
      console.log(kleur.green("✓ 已卸载 npm 包"));
    } catch {
      // 权限不足时尝试 sudo
      try {
        await execa.command(`sudo npm uninstall -g ${PACKAGE_NAME}`, {
          shell: true,
          stdio: "inherit",
        });
        console.log(kleur.green("✓ 已卸载 npm 包"));
      } catch (sudoError) {
        const msg = sudoError instanceof Error ? sudoError.message : String(sudoError);
        console.log(kleur.yellow(`⚠️  npm 卸载失败: ${msg}`));
        console.log(kleur.gray(`请手动运行: npm uninstall -g ${PACKAGE_NAME}`));
      }
    }

    // 询问是否删除配置目录
    if (await fs.pathExists(OKIT_DIR)) {
      const deleteConfigResponse = await prompts({
        type: "confirm",
        name: "deleteConfig",
        message: `是否删除配置目录 ${OKIT_DIR}？`,
        initial: false,
      });

      if (deleteConfigResponse.deleteConfig) {
        await fs.remove(OKIT_DIR);
        console.log(kleur.green(`✓ 已删除 ${OKIT_DIR}`));
      } else {
        console.log(kleur.gray(`保留配置目录 ${OKIT_DIR}`));
      }
    }

    console.log(kleur.green("\n✓ OKIT 已卸载"));
    console.log(kleur.gray("感谢使用！"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(kleur.red(`✗ 卸载失败: ${message}`));
  }
}
