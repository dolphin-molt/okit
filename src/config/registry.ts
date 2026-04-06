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

export const DEFAULT_REGISTRY: Registry = {
  steps: [
    // 系统基础
    {
      name: "Homebrew",
      install: { darwin: getHomebrewInstallCommand() },
      upgrade: { darwin: "brew update && brew upgrade" },
      check: { darwin: "command -v brew" },
      versionCmd: { darwin: "brew --version | head -1" },
    },
    // 开发基础
    {
      name: "Node.js",
      install: {
        darwin: "brew install node",
        linux: "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs",
      },
      upgrade: {
        darwin: "brew upgrade node",
        linux: "sudo apt-get update && sudo apt-get install -y nodejs",
      },
      uninstall: {
        darwin: "brew uninstall node",
        linux: "sudo apt-get remove -y nodejs",
      },
      check: "command -v node",
      versionCmd: "node --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "Git",
      install: {
        darwin: "brew install git",
        linux: "sudo apt-get update && sudo apt-get install -y git",
      },
      upgrade: {
        darwin: "brew upgrade git",
        linux: "sudo apt-get update && sudo apt-get install -y git",
      },
      uninstall: {
        darwin: "brew uninstall --force git",
        linux: "sudo apt-get remove -y git",
      },
      check: "command -v git",
      versionCmd: "git --version",
    },
    {
      name: "GitHub CLI",
      install: {
        darwin: "brew install gh",
        linux: "type -p curl >/dev/null && (curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && echo 'deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && sudo apt-get update && sudo apt-get install -y gh)",
      },
      upgrade: {
        darwin: "brew upgrade gh",
        linux: "sudo apt-get update && sudo apt-get install -y gh",
      },
      uninstall: {
        darwin: "brew uninstall gh",
        linux: "sudo apt-get remove -y gh",
      },
      check: "command -v gh",
      versionCmd: "gh --version | head -1",
      authCheck: "gh auth status 2>&1",
      authFix: "gh auth login",
      dependencies: ["Homebrew"],
    },
    {
      name: "pnpm",
      install: {
        darwin: "brew install pnpm",
        linux: "npm install -g pnpm",
      },
      upgrade: {
        darwin: "brew upgrade pnpm",
        linux: "npm update -g pnpm",
      },
      uninstall: {
        darwin: "brew uninstall pnpm",
        linux: "npm uninstall -g pnpm",
      },
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
      install: {
        darwin: "brew install python",
        linux: "sudo apt-get update && sudo apt-get install -y python3 python3-pip",
      },
      upgrade: {
        darwin: "brew upgrade python",
        linux: "sudo apt-get update && sudo apt-get install -y python3 python3-pip",
      },
      uninstall: {
        darwin: "brew uninstall python",
        linux: "sudo apt-get remove -y python3",
      },
      check: "command -v python3",
      versionCmd: "python3 --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "Docker",
      install: {
        darwin: "brew install --cask docker || echo 'Homebrew 安装失败，请手动从 https://www.docker.com/products/docker-desktop 下载安装'",
        linux: "curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER",
      },
      upgrade: {
        darwin: "brew upgrade --cask docker",
        linux: "sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io",
      },
      uninstall: {
        darwin: "brew uninstall --cask docker",
        linux: "sudo apt-get remove -y docker-ce docker-ce-cli containerd.io",
      },
      check: "command -v docker",
      versionCmd: "docker --version",
      authCheck: "docker info 2>&1 | head -3",
      authFix: "docker login",
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
      install: {
        darwin: "brew install yt-dlp",
        linux: "sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp",
      },
      upgrade: {
        darwin: "brew upgrade yt-dlp",
        linux: "sudo yt-dlp -U",
      },
      uninstall: {
        darwin: "brew uninstall yt-dlp",
        linux: "sudo rm -f /usr/local/bin/yt-dlp",
      },
      check: "command -v yt-dlp",
      versionCmd: "yt-dlp --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "curl",
      install: {
        darwin: "brew install curl",
        linux: "sudo apt-get update && sudo apt-get install -y curl",
      },
      upgrade: {
        darwin: "brew upgrade curl",
        linux: "sudo apt-get update && sudo apt-get install -y curl",
      },
      uninstall: {
        darwin: "brew uninstall curl",
        linux: "sudo apt-get remove -y curl",
      },
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
      install: {
        darwin: "brew install pandoc",
        linux: "sudo apt-get update && sudo apt-get install -y pandoc",
      },
      upgrade: {
        darwin: "brew upgrade pandoc",
        linux: "sudo apt-get update && sudo apt-get install -y pandoc",
      },
      uninstall: {
        darwin: "brew uninstall pandoc",
        linux: "sudo apt-get remove -y pandoc",
      },
      check: "command -v pandoc",
      dependencies: ["Homebrew"],
    },
    // 视频 & 多媒体
    {
      name: "ffmpeg",
      install: {
        darwin: "brew install ffmpeg",
        linux: "sudo apt-get update && sudo apt-get install -y ffmpeg",
      },
      upgrade: {
        darwin: "brew upgrade ffmpeg",
        linux: "sudo apt-get update && sudo apt-get install -y ffmpeg",
      },
      uninstall: {
        darwin: "brew uninstall ffmpeg",
        linux: "sudo apt-get remove -y ffmpeg",
      },
      check: "command -v ffmpeg",
      versionCmd: "ffmpeg -version 2>&1 | head -1",
      dependencies: ["Homebrew"],
    },
    {
      name: "ImageMagick",
      install: {
        darwin: "brew install imagemagick",
        linux: "sudo apt-get update && sudo apt-get install -y imagemagick",
      },
      upgrade: {
        darwin: "brew upgrade imagemagick",
        linux: "sudo apt-get update && sudo apt-get install -y imagemagick",
      },
      uninstall: {
        darwin: "brew uninstall imagemagick",
        linux: "sudo apt-get remove -y imagemagick",
      },
      check: "command -v convert",
      versionCmd: "convert --version | head -1",
      dependencies: ["Homebrew"],
    },
    {
      name: "pipx",
      install: {
        darwin: "brew install pipx && pipx ensurepath",
        linux: "sudo apt-get update && sudo apt-get install -y pipx && pipx ensurepath",
      },
      upgrade: {
        darwin: "brew upgrade pipx",
        linux: "sudo apt-get update && sudo apt-get install -y pipx",
      },
      uninstall: {
        darwin: "brew uninstall pipx",
        linux: "sudo apt-get remove -y pipx",
      },
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
      install: {
        darwin: "brew install duckdb",
        linux: "curl -fsSL https://install.duckdb.org | sh",
      },
      upgrade: {
        darwin: "brew upgrade duckdb",
        linux: "curl -fsSL https://install.duckdb.org | sh",
      },
      uninstall: {
        darwin: "brew uninstall duckdb",
        linux: "sudo rm -f /usr/local/bin/duckdb",
      },
      check: "command -v duckdb",
      versionCmd: "duckdb --version 2>/dev/null || echo unknown",
      dependencies: ["Homebrew"],
    },
    // 通用效率
    {
      name: "ripgrep",
      install: {
        darwin: "brew install ripgrep",
        linux: "sudo apt-get update && sudo apt-get install -y ripgrep",
      },
      upgrade: {
        darwin: "brew upgrade ripgrep",
        linux: "sudo apt-get update && sudo apt-get install -y ripgrep",
      },
      uninstall: {
        darwin: "brew uninstall ripgrep",
        linux: "sudo apt-get remove -y ripgrep",
      },
      check: "command -v rg",
      versionCmd: "rg --version | head -1",
      dependencies: ["Homebrew"],
    },
    {
      name: "fzf",
      install: {
        darwin: "brew install fzf",
        linux: "sudo apt-get update && sudo apt-get install -y fzf",
      },
      upgrade: {
        darwin: "brew upgrade fzf",
        linux: "sudo apt-get update && sudo apt-get install -y fzf",
      },
      uninstall: {
        darwin: "brew uninstall fzf",
        linux: "sudo apt-get remove -y fzf",
      },
      check: "command -v fzf",
      versionCmd: "fzf --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "tmux",
      install: {
        darwin: "brew install tmux",
        linux: "sudo apt-get update && sudo apt-get install -y tmux",
      },
      upgrade: {
        darwin: "brew upgrade tmux",
        linux: "sudo apt-get update && sudo apt-get install -y tmux",
      },
      uninstall: {
        darwin: "brew uninstall tmux",
        linux: "sudo apt-get remove -y tmux",
      },
      check: "command -v tmux",
      dependencies: ["Homebrew"],
    },
    {
      name: "iTerm2",
      install: { darwin: "brew install --cask iterm2" },
      upgrade: { darwin: "brew upgrade --cask iterm2" },
      uninstall: { darwin: "brew uninstall --cask iterm2" },
      check: { darwin: "test -d /Applications/iTerm.app" },
      dependencies: ["Homebrew"],
    },
    {
      name: "iTerm2 Browser Plugin",
      install: {
        darwin: "bash -lc 'set -euo pipefail; TMP_DIR=\"$(mktemp -d)\"; trap \"rm -rf \\\"$TMP_DIR\\\"\" EXIT; ZIP_PATH=\"$TMP_DIR/iTermBrowserPlugin-1.0.zip\"; curl -fL \"https://iterm2.com/downloads/browser-plugin/iTermBrowserPlugin-1.0.zip\" -o \"$ZIP_PATH\"; unzip -o \"$ZIP_PATH\" -d \"$TMP_DIR\" >/dev/null; APP_PATH=\"$(find \"$TMP_DIR\" -maxdepth 3 -type d -name \"iTermBrowserPlugin*.app\" | head -n 1)\"; if [ -z \"$APP_PATH\" ]; then echo \"未在压缩包中找到 iTermBrowserPlugin.app\"; exit 1; fi; sudo rm -rf \"/Applications/$(basename \"$APP_PATH\")\"; sudo mv \"$APP_PATH\" /Applications/'",
      },
      upgrade: {
        darwin: "bash -lc 'set -euo pipefail; TMP_DIR=\"$(mktemp -d)\"; trap \"rm -rf \\\"$TMP_DIR\\\"\" EXIT; ZIP_PATH=\"$TMP_DIR/iTermBrowserPlugin-1.0.zip\"; curl -fL \"https://iterm2.com/downloads/browser-plugin/iTermBrowserPlugin-1.0.zip\" -o \"$ZIP_PATH\"; unzip -o \"$ZIP_PATH\" -d \"$TMP_DIR\" >/dev/null; APP_PATH=\"$(find \"$TMP_DIR\" -maxdepth 3 -type d -name \"iTermBrowserPlugin*.app\" | head -n 1)\"; if [ -z \"$APP_PATH\" ]; then echo \"未在压缩包中找到 iTermBrowserPlugin.app\"; exit 1; fi; sudo rm -rf \"/Applications/$(basename \"$APP_PATH\")\"; sudo mv \"$APP_PATH\" /Applications/'",
      },
      uninstall: { darwin: "sudo rm -rf /Applications/iTermBrowserPlugin.app" },
      check: { darwin: "test -d /Applications/iTermBrowserPlugin.app" },
      dependencies: ["iTerm2"],
    },
    {
      name: "Warp",
      install: { darwin: "brew install --cask warp" },
      upgrade: { darwin: "brew upgrade --cask warp" },
      uninstall: { darwin: "brew uninstall --cask warp" },
      check: { darwin: "test -d /Applications/Warp.app" },
      dependencies: ["Homebrew"],
    },
    {
      name: "uv (uvx)",
      install: {
        darwin: "brew install uv",
        linux: "curl -LsSf https://astral.sh/uv/install.sh | sh",
      },
      upgrade: {
        darwin: "brew upgrade uv",
        linux: "uv self update",
      },
      uninstall: {
        darwin: "brew uninstall uv",
        linux: "uv self uninstall",
      },
      check: "command -v uv && command -v uvx",
      dependencies: ["Homebrew"],
    },
    // 部署 & 云服务
    {
      name: "Wrangler",
      install: "npm install -g wrangler",
      upgrade: "npm update -g wrangler",
      uninstall: "npm uninstall -g wrangler",
      check: "command -v wrangler",
      versionCmd: "wrangler --version 2>/dev/null | head -1",
      authCheck: "wrangler whoami 2>&1",
      authFix: "wrangler login",
      dependencies: ["Node.js"],
    },
    {
      name: "Vercel CLI",
      install: "npm install -g vercel",
      upgrade: "npm update -g vercel",
      uninstall: "npm uninstall -g vercel",
      check: "command -v vercel",
      versionCmd: "vercel --version 2>/dev/null | head -1",
      authCheck: "vercel whoami 2>&1",
      authFix: "vercel login",
      dependencies: ["Node.js"],
    },
    {
      name: "Netlify CLI",
      install: "npm install -g netlify-cli",
      upgrade: "npm update -g netlify-cli",
      uninstall: "npm uninstall -g netlify-cli",
      check: "command -v netlify",
      versionCmd: "netlify --version 2>/dev/null | head -1",
      authCheck: "netlify status 2>&1",
      authFix: "netlify login",
      dependencies: ["Node.js"],
    },
    {
      name: "AWS CLI",
      install: {
        darwin: "brew install awscli",
        linux: "curl \"https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip\" -o /tmp/awscliv2.zip && unzip -o /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install && rm -rf /tmp/awscliv2.zip /tmp/aws",
      },
      upgrade: {
        darwin: "brew upgrade awscli",
        linux: "curl \"https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip\" -o /tmp/awscliv2.zip && unzip -o /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install --update && rm -rf /tmp/awscliv2.zip /tmp/aws",
      },
      uninstall: {
        darwin: "brew uninstall awscli",
        linux: "sudo rm -rf /usr/local/aws-cli /usr/local/bin/aws /usr/local/bin/aws_completer",
      },
      check: "command -v aws",
      versionCmd: "aws --version 2>&1 | head -1",
      authCheck: "aws sts get-caller-identity 2>&1",
      authFix: "aws configure",
      dependencies: ["Homebrew"],
    },
    {
      name: "Railway CLI",
      install: "npm install -g @railway/cli",
      upgrade: "npm update -g @railway/cli",
      uninstall: "npm uninstall -g @railway/cli",
      check: "command -v railway",
      versionCmd: "railway --version 2>/dev/null",
      authCheck: "railway whoami 2>&1",
      authFix: "railway login",
      dependencies: ["Node.js"],
    },
    {
      name: "Supabase CLI",
      install: {
        darwin: "brew install supabase/tap/supabase",
        linux: "npm install -g supabase",
      },
      upgrade: {
        darwin: "brew upgrade supabase/tap/supabase",
        linux: "npm update -g supabase",
      },
      uninstall: {
        darwin: "brew uninstall supabase",
        linux: "npm uninstall -g supabase",
      },
      check: "command -v supabase",
      versionCmd: "supabase --version 2>/dev/null",
      authCheck: "supabase projects list 2>&1",
      authFix: "supabase login",
      dependencies: ["Homebrew"],
    },
    {
      name: "Firebase CLI",
      install: "npm install -g firebase-tools",
      upgrade: "npm update -g firebase-tools",
      uninstall: "npm uninstall -g firebase-tools",
      check: "command -v firebase",
      versionCmd: "firebase --version 2>/dev/null",
      authCheck: "firebase login:list 2>&1",
      authFix: "firebase login",
      dependencies: ["Node.js"],
    },
    // 网络 & 隧道
    {
      name: "ngrok",
      install: {
        darwin: "brew install ngrok/ngrok/ngrok",
        linux: "curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo 'deb https://ngrok-agent.s3.amazonaws.com buster main' | sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt-get update && sudo apt-get install -y ngrok",
      },
      upgrade: {
        darwin: "brew upgrade ngrok/ngrok/ngrok",
        linux: "sudo apt-get update && sudo apt-get install -y ngrok",
      },
      uninstall: {
        darwin: "brew uninstall ngrok",
        linux: "sudo apt-get remove -y ngrok",
      },
      check: "command -v ngrok",
      versionCmd: "ngrok --version 2>/dev/null",
      authCheck: "ngrok config check 2>&1",
      authFix: "ngrok config add-authtoken",
      dependencies: ["Homebrew"],
    },
    {
      name: "cloudflared",
      install: {
        darwin: "brew install cloudflare/cloudflare/cloudflared",
        linux: "curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && sudo dpkg -i /tmp/cloudflared.deb && rm /tmp/cloudflared.deb",
      },
      upgrade: {
        darwin: "brew upgrade cloudflare/cloudflare/cloudflared",
        linux: "curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && sudo dpkg -i /tmp/cloudflared.deb && rm /tmp/cloudflared.deb",
      },
      uninstall: {
        darwin: "brew uninstall cloudflared",
        linux: "sudo apt-get remove -y cloudflared",
      },
      check: "command -v cloudflared",
      versionCmd: "cloudflared --version 2>/dev/null",
      dependencies: ["Homebrew"],
    },
    // 云平台 CLI
    {
      name: "Google Cloud CLI",
      install: {
        darwin: "brew install --cask google-cloud-sdk",
        linux: "curl https://sdk.cloud.google.com | bash -s -- --disable-prompts && echo 'source ~/google-cloud-sdk/path.bash.inc' >> ~/.bashrc",
      },
      upgrade: {
        darwin: "brew upgrade --cask google-cloud-sdk",
        linux: "gcloud components update --quiet",
      },
      uninstall: {
        darwin: "brew uninstall --cask google-cloud-sdk",
        linux: "rm -rf ~/google-cloud-sdk && sed -i '/google-cloud-sdk/d' ~/.bashrc",
      },
      check: "command -v gcloud",
      versionCmd: "gcloud --version 2>/dev/null | head -1",
      authCheck: "gcloud auth list 2>&1 | head -5",
      authFix: "gcloud auth login",
      dependencies: ["Homebrew"],
    },
    {
      name: "Azure CLI",
      install: {
        darwin: "brew install azure-cli",
        linux: "curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash",
      },
      upgrade: {
        darwin: "brew upgrade azure-cli",
        linux: "sudo apt-get update && sudo apt-get install -y azure-cli",
      },
      uninstall: {
        darwin: "brew uninstall azure-cli",
        linux: "sudo apt-get remove -y azure-cli",
      },
      check: "command -v az",
      versionCmd: "az --version 2>/dev/null | head -1",
      authCheck: "az account show 2>&1 | head -5",
      authFix: "az login",
      dependencies: ["Homebrew"],
    },
    {
      name: "Fly.io CLI",
      install: {
        darwin: "brew install flyctl",
        linux: "curl -L https://fly.io/install.sh | sh",
      },
      upgrade: {
        darwin: "brew upgrade flyctl",
        linux: "flyctl version update",
      },
      uninstall: {
        darwin: "brew uninstall flyctl",
        linux: "rm -rf ~/.fly",
      },
      check: "command -v flyctl || command -v fly",
      versionCmd: "flyctl version 2>/dev/null | head -1",
      authCheck: "flyctl auth whoami 2>&1",
      authFix: "flyctl auth login",
      dependencies: ["Homebrew"],
    },
    {
      name: "Heroku CLI",
      install: {
        darwin: "brew tap heroku/brew && brew install heroku",
        linux: "curl https://cli-assets.heroku.com/install.sh | sh",
      },
      upgrade: {
        darwin: "brew upgrade heroku",
        linux: "curl https://cli-assets.heroku.com/install.sh | sh",
      },
      uninstall: {
        darwin: "brew uninstall heroku",
        linux: "sudo rm -rf /usr/local/lib/heroku /usr/local/bin/heroku",
      },
      check: "command -v heroku",
      versionCmd: "heroku --version 2>/dev/null | head -1",
      authCheck: "heroku auth:whoami 2>&1",
      authFix: "heroku auth:login",
      dependencies: ["Homebrew"],
    },
    // 通用效率工具
    {
      name: "jq",
      install: {
        darwin: "brew install jq",
        linux: "sudo apt-get update && sudo apt-get install -y jq",
      },
      upgrade: {
        darwin: "brew upgrade jq",
        linux: "sudo apt-get update && sudo apt-get install -y jq",
      },
      uninstall: {
        darwin: "brew uninstall jq",
        linux: "sudo apt-get remove -y jq",
      },
      check: "command -v jq",
      versionCmd: "jq --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "httpie",
      install: {
        darwin: "brew install httpie",
        linux: "sudo apt-get update && sudo apt-get install -y httpie",
      },
      upgrade: {
        darwin: "brew upgrade httpie",
        linux: "sudo apt-get update && sudo apt-get install -y httpie",
      },
      uninstall: {
        darwin: "brew uninstall httpie",
        linux: "sudo apt-get remove -y httpie",
      },
      check: "command -v http",
      versionCmd: "http --version 2>/dev/null | head -1",
      dependencies: ["Homebrew"],
    },
    {
      name: "tree",
      install: {
        darwin: "brew install tree",
        linux: "sudo apt-get update && sudo apt-get install -y tree",
      },
      upgrade: {
        darwin: "brew upgrade tree",
        linux: "sudo apt-get update && sudo apt-get install -y tree",
      },
      uninstall: {
        darwin: "brew uninstall tree",
        linux: "sudo apt-get remove -y tree",
      },
      check: "command -v tree",
      versionCmd: "tree --version 2>/dev/null | head -1",
      dependencies: ["Homebrew"],
    },
    {
      name: "bat",
      install: {
        darwin: "brew install bat",
        linux: "sudo apt-get update && sudo apt-get install -y bat",
      },
      upgrade: {
        darwin: "brew upgrade bat",
        linux: "sudo apt-get update && sudo apt-get install -y bat",
      },
      uninstall: {
        darwin: "brew uninstall bat",
        linux: "sudo apt-get remove -y bat",
      },
      check: "command -v bat",
      versionCmd: "bat --version 2>/dev/null | head -1",
      dependencies: ["Homebrew"],
    },
    {
      name: "watchman",
      install: {
        darwin: "brew install watchman",
        linux: "sudo apt-get update && sudo apt-get install -y watchman",
      },
      upgrade: {
        darwin: "brew upgrade watchman",
        linux: "sudo apt-get update && sudo apt-get install -y watchman",
      },
      uninstall: {
        darwin: "brew uninstall watchman",
        linux: "sudo apt-get remove -y watchman",
      },
      check: "command -v watchman",
      versionCmd: "watchman --version 2>/dev/null",
      dependencies: ["Homebrew"],
    },
    // 容器 & 编排
    {
      name: "kubectl",
      install: {
        darwin: "brew install kubectl",
        linux: "curl -LO \"https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl\" && sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && rm kubectl",
      },
      upgrade: {
        darwin: "brew upgrade kubectl",
        linux: "curl -LO \"https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl\" && sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && rm kubectl",
      },
      uninstall: {
        darwin: "brew uninstall kubectl",
        linux: "sudo rm -f /usr/local/bin/kubectl",
      },
      check: "command -v kubectl",
      versionCmd: "kubectl version --client --short 2>/dev/null || kubectl version --client 2>&1 | head -1",
      authCheck: "kubectl cluster-info 2>&1 | head -1",
      authFix: "kubectl config set-cluster",
      dependencies: ["Homebrew"],
    },
    {
      name: "Terraform",
      install: {
        darwin: "brew install hashicorp/tap/terraform",
        linux: "curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg && echo 'deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main' | sudo tee /etc/apt/sources.list.d/hashicorp.list && sudo apt-get update && sudo apt-get install -y terraform",
      },
      upgrade: {
        darwin: "brew upgrade hashicorp/tap/terraform",
        linux: "sudo apt-get update && sudo apt-get install -y terraform",
      },
      uninstall: {
        darwin: "brew uninstall terraform",
        linux: "sudo apt-get remove -y terraform",
      },
      check: "command -v terraform",
      versionCmd: "terraform --version 2>/dev/null | head -1",
      dependencies: ["Homebrew"],
    },
    // 数据库客户端
    {
      name: "Redis CLI",
      install: {
        darwin: "brew install redis",
        linux: "sudo apt-get update && sudo apt-get install -y redis-tools",
      },
      upgrade: {
        darwin: "brew upgrade redis",
        linux: "sudo apt-get update && sudo apt-get install -y redis-tools",
      },
      uninstall: {
        darwin: "brew uninstall redis",
        linux: "sudo apt-get remove -y redis-tools",
      },
      check: "command -v redis-cli",
      versionCmd: "redis-cli --version",
      dependencies: ["Homebrew"],
    },
    {
      name: "PostgreSQL",
      install: {
        darwin: "brew install postgresql@16",
        linux: "sudo apt-get update && sudo apt-get install -y postgresql-client",
      },
      upgrade: {
        darwin: "brew upgrade postgresql@16",
        linux: "sudo apt-get update && sudo apt-get install -y postgresql-client",
      },
      uninstall: {
        darwin: "brew uninstall postgresql@16",
        linux: "sudo apt-get remove -y postgresql-client",
      },
      check: "command -v psql",
      versionCmd: "psql --version",
      dependencies: ["Homebrew"],
    },
    // AI & LLM
    {
      name: "Ollama",
      install: {
        darwin: "brew install --cask ollama",
        linux: "curl -fsSL https://ollama.com/install.sh | sh",
      },
      upgrade: {
        darwin: "brew upgrade --cask ollama",
        linux: "curl -fsSL https://ollama.com/install.sh | sh",
      },
      uninstall: {
        darwin: "brew uninstall --cask ollama",
        linux: "sudo rm -f /usr/local/bin/ollama",
      },
      check: "command -v ollama",
      versionCmd: "ollama --version 2>/dev/null",
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
