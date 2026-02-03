import prompts from "prompts";
import kleur from "kleur";
import fs from "fs-extra";
import os from "os";
import path from "path";
import execa from "execa";
import { OKIT_DIR } from "../config/registry";

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
    // 删除二进制文件（尝试所有可能路径）
    const binCandidates = await findOkitBinaries();
    if (binCandidates.length === 0) {
      console.log(kleur.gray("未找到 okit 可执行文件"));
    } else {
      const needSudo: string[] = [];
      for (const binPath of binCandidates) {
        if (!(await fs.pathExists(binPath))) continue;
        const canDelete = await checkDeletePermission(binPath);
        if (!canDelete) {
          needSudo.push(binPath);
        } else {
          await fs.remove(binPath);
          console.log(kleur.green(`✓ 已删除 ${binPath}`));
        }
      }

      if (needSudo.length > 0) {
        console.log(kleur.yellow("⚠️  需要管理员权限来删除以下文件:"));
        needSudo.forEach((p) => console.log(kleur.yellow(`- ${p}`)));
        const sudoResponse = await prompts({
          type: "confirm",
          name: "confirm",
          message: "是否现在使用 sudo 删除？",
          initial: false,
        });
        if (sudoResponse.confirm) {
          await execa.command(`sudo rm -f ${needSudo.map((p) => `"${p}"`).join(" ")}`, {
            shell: true,
            stdio: "inherit",
          });
          needSudo.forEach((p) => console.log(kleur.green(`✓ 已删除 ${p}`)));
        } else {
          console.log(kleur.gray("已跳过 sudo 删除"));
          console.log(kleur.gray(`请运行: sudo rm ${needSudo.join(" ")}`));
        }
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

async function checkDeletePermission(filePath: string): Promise<boolean> {
  try {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    await fs.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function findOkitBinaries(): Promise<string[]> {
  const candidates = new Set<string>();

  try {
    const { stdout } = await execa.command("which -a okit", { shell: true });
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => candidates.add(line));
  } catch {
    // ignore
  }

  const home = os.homedir();
  [
    "/usr/local/bin/okit",
    "/opt/homebrew/bin/okit",
    path.join(home, ".npm-global/bin/okit"),
    path.join(home, ".local/bin/okit"),
  ].forEach((p) => candidates.add(p));

  return Array.from(candidates);
}
