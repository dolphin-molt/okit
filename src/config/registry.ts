import fs from "fs-extra";
import path from "path";
import os from "os";
import { execSync } from "child_process";

// 支持按平台区分的命令字段
// string = 全平台通用
// PlatformCmd = 按平台区分，运行时根据 process.platform 选择
export type PlatformCmd = {
  darwin?: string;
  linux?: string;
  win32?: string;
};

export type CmdField = string | PlatformCmd;

export interface AuthMethod {
  name: string;
  description?: string;
  tokenUrl?: string;
  tokenHint?: string;
  command?: string;
  recommended?: boolean;
  manual?: boolean;
  steps?: string[];
  interactive?: boolean;
  loginCommand?: string;
  autoEnter?: string;
  waitFor?: string;
}

export interface Step {
  name: string;
  install: CmdField;
  upgrade?: CmdField;
  uninstall?: CmdField;
  check?: CmdField;
  versionCmd?: CmdField;
  authCheck?: CmdField;
  authFix?: CmdField;
  dependencies?: string[];
  /** 告诉 AI 模型如何使用此工具的简要说明 */
  skill?: string;
  /** 工具简介 */
  description?: string;
  /** 详细介绍（Markdown 格式） */
  detail?: string;
  /** 官网链接 */
  homepage?: string;
  /** 多种授权方式 */
  authMethods?: AuthMethod[];
}

// 从 CmdField 中解析出当前平台的命令
export function resolveCmd(cmd: CmdField | undefined): string | undefined {
  if (cmd === undefined) return undefined;
  if (typeof cmd === "string") return cmd;
  const platform = process.platform as keyof PlatformCmd;
  return cmd[platform];
}

export interface Registry {
  steps: Step[];
}

export const OKIT_DIR = path.join(os.homedir(), ".okit");
export const REGISTRY_PATH = path.join(OKIT_DIR, "registry.json");
export const LOGS_DIR = path.join(OKIT_DIR, "logs");
export const CACHE_DIR = path.join(OKIT_DIR, "cache");

// 检测是否在中国大陆
function isInChina(): boolean {
  try {
    // 尝试访问 Google，如果失败可能是国内网络
    execSync("curl -s --connect-timeout 3 https://www.google.com -o /dev/null", {
      stdio: "ignore",
    });
    return false;
  } catch {
    return true;
  }
}

// 获取 Homebrew 安装命令
function getHomebrewInstallCommand(): string {
  const isChina = isInChina();
  const mirrorHint = isChina ? "（使用国内镜像）" : "";

  if (isChina) {
    // 国内使用 Gitee 镜像（HomebrewCN）
    return `echo "📥 正在安装 Homebrew${mirrorHint}..." && echo "⚠️  需要管理员权限，请在提示时输入密码" && /bin/zsh -c "$(curl -fsSL https://gitee.com/cunkai/HomebrewCN/raw/master/Homebrew.sh)"`;
  } else {
    // 国外使用官方源
    return `echo "📥 正在安装 Homebrew${mirrorHint}..." && echo "⚠️  需要管理员权限，请在提示时输入密码" && /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`;
  }
}

import yaml from "js-yaml";

const TOOLS_DIR = path.join(__dirname, "tools");

function loadToolsFromYaml(): Step[] {
  const order = [
    "homebrew", "mas", "nodejs", "git", "gh", "pnpm", "bun", "python", "docker",
    "codex-cli", "claude-code", "happy-coder", "gemini-cli", "gh-copilot",
    "codebuddy", "feishu-cli", "mmx-cli",
    "yt-dlp", "curl", "playwright", "chromium", "mermaid-cli", "pandoc",
    "ffmpeg", "imagemagick", "pipx", "whisper",
    "jupyter", "duckdb",
    "ripgrep", "fzf", "tmux",
    "iterm2", "iterm2-browser", "warp", "uv",
    "wrangler", "vercel", "netlify", "aws-cli", "railway", "supabase",
    "firebase", "ngrok", "cloudflared",
    "gcloud", "azure-cli", "flyctl", "heroku",
    "jq", "httpie", "tree", "bat", "watchman",
    "kubectl", "terraform",
    "redis-cli", "postgresql",
    "ollama", "openclaw", "xurl",
    "chatgpt", "obsidian", "shadowrocket", "xcode",
    "shandianshuo", "typeless",
    "raycast", "claude", "openscreen",
  ];
  const orderMap = new Map(order.map((name, i) => [name, i]));

  const steps: Step[] = [];

  for (const name of order) {
    const filePath = path.join(TOOLS_DIR, `${name}.yaml`);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf-8");
    const step = yaml.load(content) as Step;
    // Homebrew 特殊处理：动态生成安装命令
    if (step.name === "Homebrew" && typeof step.install === "object") {
      (step.install as PlatformCmd).darwin = getHomebrewInstallCommand();
    }
    steps.push(step);
  }

  // 加载不在排序列表中的额外 YAML 文件
  const allFiles = fs.readdirSync(TOOLS_DIR).filter((f) => f.endsWith(".yaml"));
  const knownFiles = new Set(order.map((n) => `${n}.yaml`));
  for (const file of allFiles) {
    if (knownFiles.has(file)) continue;
    const content = fs.readFileSync(path.join(TOOLS_DIR, file), "utf-8");
    steps.push(yaml.load(content) as Step);
  }

  return steps;
}

function getDefaultRegistry(): Registry {
  return { steps: loadToolsFromYaml() };
}

export async function ensureOkitDir(): Promise<void> {
  await fs.ensureDir(OKIT_DIR);
  await fs.ensureDir(LOGS_DIR);
  await fs.ensureDir(CACHE_DIR);
}

export async function loadRegistry(forceDefault: boolean = false): Promise<Registry> {
  await ensureOkitDir();
  const defaultRegistry = getDefaultRegistry();

  if (forceDefault || !(await fs.pathExists(REGISTRY_PATH))) {
    await saveRegistry(defaultRegistry);
    return defaultRegistry;
  }

  try {
    const content = await fs.readFile(REGISTRY_PATH, "utf-8");
    const userRegistry = JSON.parse(content) as Registry;
    const merged = mergeRegistries(defaultRegistry, userRegistry);
    return merged;
  } catch (error) {
    throw new Error(`无法解析 registry.json: ${error}`);
  }
}

export async function resetRegistry(): Promise<void> {
  await saveRegistry(getDefaultRegistry());
  console.log("✓ 配置已重置为默认");
}

export async function saveRegistry(registry: Registry): Promise<void> {
  await ensureOkitDir();
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

export async function registryExists(): Promise<boolean> {
  return fs.pathExists(REGISTRY_PATH);
}

function mergeRegistries(base: Registry, override: Registry): Registry {
  const baseSteps = base.steps ?? [];
  const overrideSteps = override.steps ?? [];
  const byName = new Map<string, Step>();

  for (const step of baseSteps) {
    if (!step?.name) continue;
    byName.set(step.name, { ...step });
  }

  for (const step of overrideSteps) {
    if (!step?.name) continue;
    const existing = byName.get(step.name);
    if (existing) {
      // Only override with non-null/non-undefined fields from user registry
      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(step)) {
        if (value !== undefined && value !== null && value !== '') {
          filtered[key] = value;
        }
      }
      byName.set(step.name, { ...existing, ...filtered });
    } else {
      byName.set(step.name, { ...step });
    }
  }

  const mergedSteps = Array.from(byName.values());
  const mermaid = mergedSteps.find((step) => step.name === "Mermaid CLI");
  if (mermaid && mermaid.install === "npm install -g @mermaid-js/mermaid-cli") {
    const baseMermaid = baseSteps.find((step) => step.name === "Mermaid CLI");
    if (baseMermaid?.install) {
      mermaid.install = baseMermaid.install;
    }
    if (baseMermaid?.upgrade) {
      mermaid.upgrade = baseMermaid.upgrade;
    }
  }

  return { steps: mergedSteps };
}
