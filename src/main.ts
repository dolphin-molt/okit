#!/usr/bin/env node

import { Command } from "commander";
import kleur from "kleur";
import prompts from "prompts";
import pkg from "../package.json";
import { showMainMenu, showClaudeMenu } from "./commands/menu";
import { showUpgradeMenu, upgradeSelf, upgradeTools } from "./commands/upgrade";
import { uninstallOkit } from "./commands/uninstall";
import { showRepoMenu, createRepositoryFlow } from "./commands/repo";
import { resetRegistry } from "./config/registry";
import { setLanguage, getLanguage, t, Language, initLanguage, loadLanguageConfig } from "./config/i18n";
import { loadUserConfig, updateUserConfig } from "./config/user";

const program = new Command();

// 显示 Banner
function showBanner(): void {
  const banner = `
 ██████╗  ██╗  ██╗  ██╗  ████████╗
██╔═══██╗ ██║ ██╔╝  ██║  ╚══██╔══╝
██║   ██║ █████╔╝   ██║     ██║   
██║   ██║ ██╔═██╗   ██║     ██║   
╚██████╔╝ ██║  ██╗  ██║     ██║   
 ╚═════╝  ╚═╝  ╚═╝  ╚═╝     ╚═╝   
  `;
  console.log(kleur.cyan(banner));
  console.log(kleur.gray("  OKIT v1 - macOS 开发工具管理器\n"));
}

program
  .name("okit")
  .description("OKIT v1 - 精简版工具执行器")
  .version(pkg.version);

function getUnknownSubcommand(): string | null {
  const argv = process.argv.slice(2);
  const firstArg = argv.find((arg) => !arg.startsWith("-"));
  if (!firstArg) return null;
  const known = new Set(program.commands.map((cmd) => cmd.name()));
  return known.has(firstArg) ? null : firstArg;
}

// 语言选择（首次运行时显示）
async function selectLanguageIfNeeded(): Promise<void> {
  // 先尝试加载已保存的语言配置
  const savedLang = await loadLanguageConfig();
  
  if (savedLang) {
    // 已有配置，直接使用
    setLanguage(savedLang);
    return;
  }
  
  // 首次运行，显示语言选择
  const response = await prompts({
    type: "select",
    name: "lang",
    message: "选择语言 / Select language",
    choices: [
      { title: "中文", value: "zh" },
      { title: "English", value: "en" },
    ],
  });

  if (response.lang) {
    setLanguage(response.lang);
  }
}

// 配置 prompts 使用中文提示
function configurePrompts(lang: Language) {
  if (lang === "zh") {
    // 设置 prompts 的默认提示文本
    (prompts as any).prompts = {
      ...(prompts as any).prompts,
      autocomplete: {
        instructions: "上下箭头选择，回车确认，输入过滤",
      },
      autocompleteMultiselect: {
        instructions: "↑/↓: 高亮选项，←/→/空格: 选择/取消，Ctrl+A: 全选/取消全选，回车: 确认，Ctrl+C: 取消",
      },
      multiselect: {
        instructions: "↑/↓: 高亮选项，空格: 选择/取消，Ctrl+A: 全选/取消全选，回车: 确认",
      },
      select: {
        instructions: "↑/↓: 选择，回车: 确认",
      },
    };
  }
}

// 默认：交互菜单
program.action(async () => {
  const unknown = getUnknownSubcommand();
  if (unknown) {
    console.log(kleur.red(`✗ Unknown command: ${unknown}`));
    program.outputHelp();
    process.exit(1);
  }
  checkPlatform();
  showBanner();
  await selectLanguageIfNeeded();
  configurePrompts(getLanguage());
  await showMainHelpHintOnce();
  await showMainMenu();
});

// upgrade 子命令
program
  .command("upgrade")
  .description("升级 OKIT（默认）或工具")
  .option("--tools", "升级所有工具")
  .option("--menu", "打开升级菜单")
  .action(async (options: { tools?: boolean; menu?: boolean }) => {
    checkPlatform();
    await selectLanguageIfNeeded();
    if (options.menu) {
      await showUpgradeMenu();
      return;
    }
    if (options.tools) {
      await upgradeTools();
      return;
    }
    await upgradeSelf();
  });

// uninstall 子命令
program
  .command("uninstall")
  .description("卸载 OKIT")
  .action(async () => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await uninstallOkit();
  });

// claude 子命令
program
  .command("claude")
  .description("Claude Code 交互菜单")
  .action(async () => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await showClaudeMenu();
  });

// repo 子命令
const repo = program
  .command("repo")
  .description("Repo 设置与创建")
  .action(async () => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await showRepoMenu();
  });

repo
  .command("create")
  .description("创建远程仓库并绑定")
  .action(async () => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await createRepositoryFlow();
  });

// reset 子命令 - 不需要选择语言
program
  .command("reset")
  .description("重置配置为默认")
  .action(async () => {
    checkPlatform();
    // reset 使用默认中文
    setLanguage("zh");
    await resetRegistry();
  });

// web 子命令 - 启动 Web UI
program
  .command("web")
  .description("启动 Claude Code Web UI")
  .option("-p, --port <number>", "端口号", "3000")
  .option("-o, --open", "自动打开浏览器", false)
  .action(async (options: { port: string; open: boolean }) => {
    checkPlatform();
    const port = parseInt(options.port, 10) || 3000;

    // 动态导入 web server
    // @ts-ignore
    const { startServer } = await import("./web/server.js");

    if (options.open) {
      const { exec } = await import("child_process");
      exec(`open http://localhost:${port}`);
    }

    // @ts-ignore
    startServer(port);
  });

function checkPlatform() {
  if (process.platform !== "darwin") {
    console.log(kleur.red("✗ 当前仅支持 macOS 平台"));
    process.exit(1);
  }
}

async function showMainHelpHintOnce(): Promise<void> {
  const config = await loadUserConfig();
  if (config.hints?.mainHelpShown) return;
  console.log(kleur.gray(t("mainHelpHint")));
  await updateUserConfig({ hints: { mainHelpShown: true } });
}

program.parse();
