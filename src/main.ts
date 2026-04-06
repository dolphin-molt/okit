#!/usr/bin/env node

import { Command } from "commander";
import kleur from "kleur";
import prompts from "prompts";
import pkg from "../package.json";
import { showMainMenu, showClaudeMenu } from "./commands/menu";
import { showUpgradeMenu, upgradeSelf, upgradeTools } from "./commands/upgrade";
import { uninstallOkit } from "./commands/uninstall";
import { showRepoMenu, createRepositoryFlow } from "./commands/repo";
import { runCheck } from "./commands/check";
import { runAuth } from "./commands/auth";
import { relayConnect, relayStatus, relayCreate, relayConfig, relayAgents } from "./commands/relay";
import {
  vaultSet,
  vaultGet,
  vaultList,
  vaultDelete,
  vaultInject,
  vaultEnv,
  vaultWhere,
  vaultSync,
} from "./commands/vault";
import {
  showProfileMenu,
  createProfile,
  applyProfile,
  showProfiles,
  showProfileDetail,
  removeProfile,
  exportProfile,
  importProfile,
} from "./commands/profile";
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
  console.log(kleur.gray(`  OKIT v${pkg.version} - macOS 开发工具管理器\n`));
}

program
  .name("okit")
  .description("OKIT - Agent 基础设施管理工具")
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

// check 子命令 - 环境健康检查
program
  .command("check")
  .description("环境健康检查（工具版本、升级、授权状态）")
  .option("--json", "输出 JSON 格式（适合 Agent 消费）")
  .action(async (options: { json?: boolean }) => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await runCheck({ json: options.json });
  });

// profile 子命令
const profile = program
  .command("profile")
  .description("管理工具 Profile（一键安装预设工具集）")
  .action(async () => {
    checkPlatform();
    await selectLanguageIfNeeded();
    configurePrompts(getLanguage());
    await showProfileMenu();
  });

profile
  .command("create")
  .description("创建新 Profile")
  .action(async () => {
    checkPlatform();
    await selectLanguageIfNeeded();
    configurePrompts(getLanguage());
    await createProfile();
  });

profile
  .command("apply [name]")
  .description("应用 Profile（安装所有工具）")
  .action(async (name?: string) => {
    checkPlatform();
    await selectLanguageIfNeeded();
    configurePrompts(getLanguage());
    await applyProfile(name);
  });

profile
  .command("list")
  .description("列出所有 Profile")
  .action(async () => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await showProfiles();
  });

profile
  .command("show <name>")
  .description("查看 Profile 详情及安装状态")
  .action(async (name: string) => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await showProfileDetail(name);
  });

profile
  .command("delete [name]")
  .description("删除 Profile")
  .action(async (name?: string) => {
    checkPlatform();
    await selectLanguageIfNeeded();
    configurePrompts(getLanguage());
    await removeProfile(name);
  });

profile
  .command("export [name]")
  .description("导出 Profile 为 JSON 文件")
  .option("-o, --output <path>", "输出路径")
  .action(async (name?: string, options?: { output?: string }) => {
    checkPlatform();
    await selectLanguageIfNeeded();
    configurePrompts(getLanguage());
    await exportProfile(name, options?.output);
  });

profile
  .command("import <file>")
  .description("从 JSON 文件导入 Profile")
  .action(async (file: string) => {
    checkPlatform();
    await selectLanguageIfNeeded();
    configurePrompts(getLanguage());
    await importProfile(file);
  });

// auth 子命令 - 授权生命周期管理
program
  .command("auth")
  .description("检查并修复工具授权状态")
  .option("--fix", "尝试自动修复授权问题")
  .action(async (options: { fix?: boolean }) => {
    checkPlatform();
    await selectLanguageIfNeeded();
    await runAuth({ fix: options.fix });
  });

// vault 子命令 - 密钥管理
const vault = program
  .command("vault")
  .description("密钥管理（加密存储、按需注入、项目关联）")
  .action(async () => {
    await vaultList();
  });

vault
  .command("set <key> <value>")
  .description("存储密钥（支持 KEY/alias 格式，如 GITHUB_TOKEN/company）")
  .action(async (key: string, value: string) => {
    await vaultSet(key, value);
  });

vault
  .command("get <key>")
  .description("获取密钥明文（支持 KEY/alias 格式）")
  .action(async (key: string) => {
    await vaultGet(key);
  });

vault
  .command("list")
  .description("列出所有密钥（脱敏显示）")
  .action(async () => {
    await vaultList();
  });

vault
  .command("delete <key>")
  .description("删除密钥")
  .action(async (key: string) => {
    await vaultDelete(key);
  });

vault
  .command("inject")
  .description("输出 shell export 语句（配合 eval 使用）")
  .option("--keys <keys>", "手动指定 key 列表（逗号分隔）")
  .option("--dir <dir>", "指定项目目录")
  .action(async (options: { keys?: string; dir?: string }) => {
    await vaultInject(options);
  });

vault
  .command("env [file]")
  .description("根据 .okitenv 生成 .env 文件并注册关联")
  .option("--dir <dir>", "指定项目目录")
  .action(async (file?: string, options?: { dir?: string }) => {
    await vaultEnv(file, options);
  });

vault
  .command("where <key>")
  .description("查看密钥在哪些项目中使用")
  .action(async (key: string) => {
    await vaultWhere(key);
  });

vault
  .command("sync")
  .description("同步所有关联文件（更新密钥后自动刷新）")
  .action(async () => {
    await vaultSync();
  });

// relay 子命令 - 中继服务器
const relay = program
  .command("relay")
  .description("中继服务器（本地服务安全暴露到外网）");

relay
  .command("config")
  .description("配置中继服务器地址和认证 token")
  .option("--url <url>", "中继服务器 URL")
  .option("--token <token>", "认证 token")
  .action(async (options: { url?: string; token?: string }) => {
    await relayConfig(options);
  });

relay
  .command("connect")
  .description("连接本地服务到中继")
  .requiredOption("--tunnel <id>", "隧道 ID")
  .requiredOption("--agent <name>", "Agent 名称（用于注册和路由）")
  .option("--target <url>", "本地目标地址", "http://localhost:3000")
  .action(async (options: { tunnel: string; agent: string; target: string }) => {
    await relayConnect(options);
  });

relay
  .command("status <tunnel>")
  .description("查看隧道状态")
  .action(async (tunnel: string) => {
    await relayStatus(tunnel);
  });

relay
  .command("create [tunnel]")
  .description("创建隧道")
  .action(async (tunnel?: string) => {
    await relayCreate(tunnel);
  });

relay
  .command("agents")
  .description("列出所有在线 Agent")
  .action(async () => {
    await relayAgents();
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
  const supported = ["darwin", "linux"];
  if (!supported.includes(process.platform)) {
    console.log(kleur.red(`✗ 当前不支持 ${process.platform} 平台 (支持: macOS, Linux)`));
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
