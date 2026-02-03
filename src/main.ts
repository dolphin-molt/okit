#!/usr/bin/env node

import { Command } from "commander";
import kleur from "kleur";
import prompts from "prompts";
import { showMainMenu } from "./commands/menu";
import { showUpgradeMenu } from "./commands/upgrade";
import { uninstallOkit } from "./commands/uninstall";
import { runClaudeCommand, addClaudeProfile } from "./commands/claude";
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
  .version("2.0.0");

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
  .description("升级菜单（OKIT 自身 / 工具）")
  .action(async () => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await showUpgradeMenu();
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
const claude = program
  .command("claude")
  .description("Claude Code 配置切换与启动")
  .action(async () => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await runClaudeCommand("run");
  });

claude
  .command("switch")
  .description("切换 Claude Code 配置")
  .action(async () => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await runClaudeCommand("switch");
  });

claude
  .command("add")
  .description("添加 Claude Code 配置")
  .action(async () => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await addClaudeProfile();
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
