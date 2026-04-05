import fs from "fs-extra";
import path from "path";
import os from "os";
import { execSync } from "child_process";

export interface Step {
  name: string;
  install: string;
  upgrade?: string;
  uninstall?: string;
  check?: string;
  versionCmd?: string;   // 获取版本号的命令，如 "node --version"
  authCheck?: string;    // 检查授权状态的命令，如 "gh auth status"
  dependencies?: string[]; // 依赖的其他工具名称列表
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

export const DEFAULT_REGISTRY: Registry = {
  steps: [
    // 系统基础
    {
      name: "Homebrew",
      install: getHomebrewInstallCommand(),
      upgrade: "brew update && brew upgrade",
      check: "command -v brew",
      versionCmd: "brew --version | head -1",
    },
    // 开发基础
    {
      name: "Node.js",
      install: "brew install node",
      upgrade: "brew upgrade node",
      uninstall: "brew uninstall node",
      check: "command -v node",
      versionCmd: "node --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "Git",
      install: "brew install git",
      upgrade: "brew upgrade git",
      uninstall: "brew uninstall --force git",
      check: "command -v git",
      versionCmd: "git --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "GitHub CLI",
      install: "brew install gh",
      upgrade: "brew upgrade gh",
      uninstall: "brew uninstall gh",
      check: "command -v gh",
      versionCmd: "gh --version | head -1",
      authCheck: "gh auth status 2>&1",
      dependencies: ["Homebrew"],
    },
    {
      name: "pnpm",
      install: "brew install pnpm",
      upgrade: "brew upgrade pnpm",
      uninstall: "brew uninstall pnpm",
      check: "command -v pnpm",
      versionCmd: "pnpm --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "bun",
      install: "curl -fsSL https://bun.sh/install | bash",
      upgrade: "bun upgrade",
      uninstall: "~/.bun/uninstall.sh",
      check: "command -v bun",
      versionCmd: "bun --version",
    },
    {
      name: "Python",
      install: "brew install python",
      upgrade: "brew upgrade python",
      uninstall: "brew uninstall python",
      check: "command -v python3",
      versionCmd: "python3 --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "Docker",
      install: "echo '正在安装 Docker Desktop...' && brew install --cask docker || (echo 'Homebrew 安装失败，请手动从 https://www.docker.com/products/docker-desktop 下载安装' && exit 1)",
      upgrade: "brew upgrade --cask docker",
      uninstall: "brew uninstall --cask docker",
      check: "command -v docker",
      versionCmd: "docker --version",
      authCheck: "docker info 2>&1 | head -3",
      dependencies: ["Homebrew"],
    },
    // AI Coding
    {
      name: "Codex CLI",
      install: "sudo npm install -g @openai/codex",
      upgrade: "sudo npm update -g @openai/codex",
      uninstall: "sudo npm uninstall -g @openai/codex",
      check: "command -v codex",
      versionCmd: "codex --version 2>/dev/null || echo unknown",
      dependencies: ["Node.js"],
    },
    {
      name: "Claude Code",
      install: "sudo npm install -g @anthropic-ai/claude-code",
      upgrade: "sudo npm update -g @anthropic-ai/claude-code",
      uninstall: "sudo npm uninstall -g @anthropic-ai/claude-code",
      check: "command -v claude",
      versionCmd: "claude --version 2>/dev/null || echo unknown",
      dependencies: ["Node.js"],
    },
    {
      name: "Happy Coder",
      install: "npm install -g happy-coder",
      upgrade: "npm update -g happy-coder",
      uninstall: "npm uninstall -g happy-coder",
      check: "command -v happy-coder",
      dependencies: ["Node.js"],
    },
    // 信息抓取
    {
      name: "yt-dlp",
      install: "brew install yt-dlp",
      upgrade: "brew upgrade yt-dlp",
      uninstall: "brew uninstall yt-dlp",
      check: "command -v yt-dlp",
      versionCmd: "yt-dlp --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "curl",
      install: "brew install curl",
      upgrade: "brew upgrade curl",
      uninstall: "brew uninstall curl",
      check: "command -v curl",
      versionCmd: "curl --version | head -1",
      dependencies: ["Homebrew"],
    },
    {
      name: "Playwright",
      install: "echo '安装 Playwright (跳过浏览器下载，请稍后手动运行: npx playwright install)' && sudo npm install -g @playwright/test",
      upgrade: "sudo npm update -g @playwright/test",
      uninstall: "sudo npm uninstall -g @playwright/test",
      check: "command -v playwright",
      dependencies: ["Node.js"],
    },
    // 文档 & 图表
    {
      name: "Chromium (Puppeteer)",
      install: "echo '安装 Puppeteer 浏览器 (Chromium)...' && sudo npm install -g puppeteer && npx puppeteer browsers install chrome",
      upgrade: "sudo npm update -g puppeteer && npx puppeteer browsers install chrome",
      uninstall: "sudo npm uninstall -g puppeteer && sudo rm -rf ~/.cache/puppeteer",
      check: "command -v puppeteer || ls ~/.cache/puppeteer/chrome/*/chrome-mac/Chromium.app 2>/dev/null || ls ~/.cache/puppeteer/chrome/*/chrome-linux/chrome 2>/dev/null",
      dependencies: ["Node.js"],
    },
    {
      name: "Mermaid CLI",
      install:
        "echo '安装 Mermaid CLI (跳过 Puppeteer 浏览器下载)' && mkdir -p \"$HOME/.cache/puppeteer\" && chmod -R u+rwX \"$HOME/.cache/puppeteer\" || true && PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_CACHE_DIR=\"$HOME/.cache/puppeteer\" npm install -g @mermaid-js/mermaid-cli",
      upgrade:
        "mkdir -p \"$HOME/.cache/puppeteer\" && chmod -R u+rwX \"$HOME/.cache/puppeteer\" || true && PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_CACHE_DIR=\"$HOME/.cache/puppeteer\" npm update -g @mermaid-js/mermaid-cli",
      uninstall: "sudo npm uninstall -g @mermaid-js/mermaid-cli",
      check: "command -v mmdc",
      dependencies: ["Node.js"],
    },
    {
      name: "Pandoc",
      install: "brew install pandoc",
      upgrade: "brew upgrade pandoc",
      uninstall: "brew uninstall pandoc",
      check: "command -v pandoc",
      dependencies: ["Homebrew"],
    },
    // 视频 & 多媒体
    {
      name: "ffmpeg",
      install: "brew install ffmpeg",
      upgrade: "brew upgrade ffmpeg",
      uninstall: "brew uninstall ffmpeg",
      check: "command -v ffmpeg",
      versionCmd: "ffmpeg -version 2>&1 | head -1",
      dependencies: ["Homebrew"],
    },
    {
      name: "ImageMagick",
      install: "brew install imagemagick",
      upgrade: "brew upgrade imagemagick",
      uninstall: "brew uninstall imagemagick",
      check: "command -v convert",
      versionCmd: "convert --version | head -1",
      dependencies: ["Homebrew"],
    },
    {
      name: "pipx",
      install: "brew install pipx && pipx ensurepath",
      upgrade: "brew upgrade pipx",
      uninstall: "brew uninstall pipx",
      check: "command -v pipx",
      versionCmd: "pipx --version",
      dependencies: ["Homebrew", "Python"],
    },
    {
      name: "Whisper",
      install: "pipx install openai-whisper",
      upgrade: "pipx upgrade openai-whisper",
      uninstall: "pipx uninstall openai-whisper",
      check: "command -v whisper",
      dependencies: ["pipx"],
    },
    // 数据 & 分析
    {
      name: "Jupyter",
      install: "pipx install --include-deps jupyter",
      upgrade: "pipx upgrade --include-deps jupyter",
      uninstall: "pipx uninstall jupyter",
      check: "command -v jupyter",
      dependencies: ["pipx"],
    },
    {
      name: "DuckDB",
      install: "brew install duckdb",
      upgrade: "brew upgrade duckdb",
      uninstall: "brew uninstall duckdb",
      check: "command -v duckdb",
      versionCmd: "duckdb --version 2>/dev/null || echo unknown",
      dependencies: ["Homebrew"],
    },
    // 通用效率
    {
      name: "ripgrep",
      install: "brew install ripgrep",
      upgrade: "brew upgrade ripgrep",
      uninstall: "brew uninstall ripgrep",
      check: "command -v rg",
      versionCmd: "rg --version | head -1",
      dependencies: ["Homebrew"],
    },
    {
      name: "fzf",
      install: "brew install fzf",
      upgrade: "brew upgrade fzf",
      uninstall: "brew uninstall fzf",
      check: "command -v fzf",
      versionCmd: "fzf --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "tmux",
      install: "brew install tmux",
      upgrade: "brew upgrade tmux",
      uninstall: "brew uninstall tmux",
      check: "command -v tmux",
      dependencies: ["Homebrew"],
    },
    {
      name: "iTerm2",
      install: "brew install --cask iterm2",
      upgrade: "brew upgrade --cask iterm2",
      uninstall: "brew uninstall --cask iterm2",
      check: "test -d /Applications/iTerm.app",
      dependencies: ["Homebrew"],
    },
    {
      name: "iTerm2 Browser Plugin",
      install:
        "bash -lc 'set -euo pipefail; TMP_DIR=\"$(mktemp -d)\"; trap \"rm -rf \\\"$TMP_DIR\\\"\" EXIT; ZIP_PATH=\"$TMP_DIR/iTermBrowserPlugin-1.0.zip\"; curl -fL \"https://iterm2.com/downloads/browser-plugin/iTermBrowserPlugin-1.0.zip\" -o \"$ZIP_PATH\"; unzip -o \"$ZIP_PATH\" -d \"$TMP_DIR\" >/dev/null; APP_PATH=\"$(find \"$TMP_DIR\" -maxdepth 3 -type d -name \"iTermBrowserPlugin*.app\" | head -n 1)\"; if [ -z \"$APP_PATH\" ]; then echo \"未在压缩包中找到 iTermBrowserPlugin.app\"; exit 1; fi; sudo rm -rf \"/Applications/$(basename \"$APP_PATH\")\"; sudo mv \"$APP_PATH\" /Applications/'",
      upgrade:
        "bash -lc 'set -euo pipefail; TMP_DIR=\"$(mktemp -d)\"; trap \"rm -rf \\\"$TMP_DIR\\\"\" EXIT; ZIP_PATH=\"$TMP_DIR/iTermBrowserPlugin-1.0.zip\"; curl -fL \"https://iterm2.com/downloads/browser-plugin/iTermBrowserPlugin-1.0.zip\" -o \"$ZIP_PATH\"; unzip -o \"$ZIP_PATH\" -d \"$TMP_DIR\" >/dev/null; APP_PATH=\"$(find \"$TMP_DIR\" -maxdepth 3 -type d -name \"iTermBrowserPlugin*.app\" | head -n 1)\"; if [ -z \"$APP_PATH\" ]; then echo \"未在压缩包中找到 iTermBrowserPlugin.app\"; exit 1; fi; sudo rm -rf \"/Applications/$(basename \"$APP_PATH\")\"; sudo mv \"$APP_PATH\" /Applications/'",
      uninstall: "sudo rm -rf /Applications/iTermBrowserPlugin.app",
      check: "test -d /Applications/iTermBrowserPlugin.app",
      dependencies: ["iTerm2"],
    },
    {
      name: "Warp",
      install: "brew install --cask warp",
      upgrade: "brew upgrade --cask warp",
      uninstall: "brew uninstall --cask warp",
      check: "test -d /Applications/Warp.app",
      dependencies: ["Homebrew"],
    },
    {
      name: "uv (uvx)",
      install: "brew install uv",
      upgrade: "brew upgrade uv",
      uninstall: "brew uninstall uv",
      check: "command -v uv && command -v uvx",
      dependencies: ["Homebrew"],
    },
    {
      name: "OpenClaw",
      install:
        "bash -c 'set -e; if command -v curl >/dev/null 2>&1; then curl -fsSL https://openclaw.ai/install.sh | bash; elif command -v npm >/dev/null 2>&1; then npm install -g openclaw@latest; elif command -v pnpm >/dev/null 2>&1; then pnpm add -g openclaw@latest; else echo \"缺少 curl/npm/pnpm，无法安装 OpenClaw\"; exit 1; fi'",
      upgrade:
        "bash -c 'set -e; if command -v npm >/dev/null 2>&1; then npm update -g openclaw@latest; elif command -v pnpm >/dev/null 2>&1; then pnpm add -g openclaw@latest; elif command -v curl >/dev/null 2>&1; then curl -fsSL https://openclaw.ai/install.sh | bash; else echo \"缺少 curl/npm/pnpm，无法升级 OpenClaw\"; exit 1; fi'",
      uninstall:
        "bash -c 'if command -v openclaw >/dev/null 2>&1; then openclaw uninstall; elif command -v npm >/dev/null 2>&1; then npm uninstall -g openclaw; elif command -v pnpm >/dev/null 2>&1; then pnpm remove -g openclaw; else echo \"请手动移除 OpenClaw（可能由安装脚本安装）\"; fi'",
      check: "command -v openclaw",
      dependencies: ["Node.js"],
    },
  ],
};

export async function ensureOkitDir(): Promise<void> {
  await fs.ensureDir(OKIT_DIR);
  await fs.ensureDir(LOGS_DIR);
  await fs.ensureDir(CACHE_DIR);
}

export async function loadRegistry(forceDefault: boolean = false): Promise<Registry> {
  await ensureOkitDir();

  if (forceDefault || !(await fs.pathExists(REGISTRY_PATH))) {
    await saveRegistry(DEFAULT_REGISTRY);
    return DEFAULT_REGISTRY;
  }

  try {
    const content = await fs.readFile(REGISTRY_PATH, "utf-8");
    const userRegistry = JSON.parse(content) as Registry;
    const merged = mergeRegistries(DEFAULT_REGISTRY, userRegistry);
    return merged;
  } catch (error) {
    throw new Error(`无法解析 registry.json: ${error}`);
  }
}

export async function resetRegistry(): Promise<void> {
  await saveRegistry(DEFAULT_REGISTRY);
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
      byName.set(step.name, { ...existing, ...step });
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
