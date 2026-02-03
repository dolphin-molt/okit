import prompts from "prompts";
import kleur from "kleur";
import fs from "fs-extra";
import { OKIT_DIR } from "../config/registry";

const OKIT_BIN_PATH = "/usr/local/bin/okit";

export async function uninstallOkit(): Promise<void> {
  console.log(kleur.cyan("\n🗑️  Uninstall OKIT\n"));

  // 确认卸载
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
    // 删除二进制文件
    if (await fs.pathExists(OKIT_BIN_PATH)) {
      const canDelete = await checkDeletePermission(OKIT_BIN_PATH);
      if (!canDelete) {
        console.log(kleur.yellow("⚠️  需要管理员权限来删除 OKIT"));
        console.log(kleur.gray(`请运行: sudo rm ${OKIT_BIN_PATH}`));
      } else {
        await fs.remove(OKIT_BIN_PATH);
        console.log(kleur.green(`✓ 已删除 ${OKIT_BIN_PATH}`));
      }
    } else {
      console.log(kleur.gray(`okit 未安装在 ${OKIT_BIN_PATH}`));
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

async function checkDeletePermission(filePath: string): Promise<boolean> {
  try {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    await fs.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
