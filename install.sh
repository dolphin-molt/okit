#!/bin/bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
INSTALL_DIR="/usr/local/bin"
OKIT_DIR="$HOME/.okit"
BINARY_NAME="okit"

echo -e "${BLUE}🚀 安装 OKIT...${NC}"

# Check if macOS
OS=$(uname -s)
if [[ "$OS" != "Darwin" ]]; then
    echo -e "${RED}✗ 当前仅支持 macOS 平台${NC}"
    exit 1
fi

# ============================================
# 安装基础依赖
# ============================================

echo -e "${BLUE}🔧 检查并安装基础依赖...${NC}"

# 1. 安装 Homebrew
if ! command -v brew &> /dev/null; then
    echo -e "${YELLOW}⚠️  Homebrew 未安装，正在安装...${NC}"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # 添加 Homebrew 到 PATH
    if [[ -f /opt/homebrew/bin/brew ]]; then
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f /usr/local/bin/brew ]]; then
        echo 'eval "$(/usr/local/bin/brew shellenv)"' >> "$HOME/.zprofile"
        eval "$(/usr/local/bin/brew shellenv)"
    fi
    echo -e "${GREEN}✓ Homebrew 安装成功${NC}"
else
    echo -e "${GREEN}✓ Homebrew 已安装${NC}"
fi

# 2. 安装 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}⚠️  Node.js 未安装，正在安装...${NC}"
    brew install node
    echo -e "${GREEN}✓ Node.js 安装成功${NC}"
else
    echo -e "${GREEN}✓ Node.js 已安装 ($(node -v))${NC}"
fi

# 3. 检查 npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm 未找到，请检查 Node.js 安装${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm 已安装 ($(npm -v))${NC}"

# 3.1 配置 npm 全局目录到用户目录（避免 /usr/local 权限问题）
NPM_GLOBAL_PREFIX="${HOME}/.npm-global"
mkdir -p "$NPM_GLOBAL_PREFIX"
npm config set prefix "$NPM_GLOBAL_PREFIX"
if [[ "$SHELL" == *"zsh"* ]]; then
    if ! grep -q ".npm-global/bin" "$HOME/.zshrc" 2>/dev/null; then
        echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.zshrc"
    fi
elif [[ "$SHELL" == *"bash"* ]]; then
    if ! grep -q ".npm-global/bin" "$HOME/.bashrc" 2>/dev/null; then
        echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.bashrc"
    fi
fi
export PATH="$HOME/.npm-global/bin:$PATH"
echo -e "${GREEN}✓ npm 全局安装已配置为用户目录${NC}"

# 4. 安装 pipx
if ! command -v pipx &> /dev/null; then
    # 确保 python3 存在（pipx 依赖）
    if ! command -v python3 &> /dev/null; then
        echo -e "${YELLOW}⚠️  Python 未安装，正在安装...${NC}"
        brew install python
        echo -e "${GREEN}✓ Python 安装成功${NC}"
    fi
    echo -e "${YELLOW}⚠️  pipx 未安装，正在安装...${NC}"
    brew install pipx
    if command -v pipx &> /dev/null; then
        pipx ensurepath || true
    else
        echo -e "${YELLOW}⚠️  pipx 可执行文件不可用，已跳过 ensurepath${NC}"
    fi
    echo -e "${GREEN}✓ pipx 安装成功${NC}"
else
    echo -e "${GREEN}✓ pipx 已安装${NC}"
fi

echo -e "${GREEN}✓ 基础依赖检查完成${NC}"
echo ""

# ============================================
# 安装 OKIT
# ============================================

# Detect platform
ARCH=$(uname -m)
OKIT_REPO="dolphin-molt/okit"
OKIT_VERSION="${OKIT_VERSION:-}"

# Determine architecture
if [[ "$ARCH" == "arm64" ]]; then
    echo -e "${BLUE}📦 检测到 Apple Silicon (arm64)${NC}"
    BINARY_NAME="okit-macos-arm64"
elif [[ "$ARCH" == "x86_64" ]]; then
    echo -e "${BLUE}📦 检测到 Intel (x64)${NC}"
    BINARY_NAME="okit-macos-x64"
else
    echo -e "${RED}✗ 不支持的架构: $ARCH${NC}"
    exit 1
fi

# Check if install directory exists and is writable
if [[ ! -d "$INSTALL_DIR" ]]; then
    echo -e "${YELLOW}⚠️  $INSTALL_DIR 不存在，尝试创建...${NC}"
    sudo mkdir -p "$INSTALL_DIR" || {
        echo -e "${RED}✗ 无法创建 $INSTALL_DIR${NC}"
        exit 1
    }
fi

# Check write permission
if [[ ! -w "$INSTALL_DIR" ]]; then
    echo -e "${YELLOW}⚠️  需要管理员权限来安装到 $INSTALL_DIR${NC}"
    USE_SUDO=true
else
    USE_SUDO=false
fi

# Create OKIT directory
echo -e "${BLUE}📂 创建配置目录: $OKIT_DIR${NC}"
mkdir -p "$OKIT_DIR"
mkdir -p "$OKIT_DIR/logs"
mkdir -p "$OKIT_DIR/cache"

# Find and copy binary
if [[ -f "./bin/$BINARY_NAME" ]]; then
    echo -e "${BLUE}📂 使用本地构建版本 ($BINARY_NAME)${NC}"
    BINARY_SOURCE="./bin/$BINARY_NAME"
elif [[ -f "./dist/main.js" ]]; then
    echo -e "${BLUE}📂 使用本地源码版本${NC}"
    BINARY_SOURCE="./dist/main.js"
else
    echo -e "${BLUE}🌐 下载 Release 二进制${NC}"
    if [[ -z "$OKIT_VERSION" ]]; then
        OKIT_VERSION="$(python3 - <<'PY'
import json, sys, urllib.request
repo = "dolphin-molt/okit"

def fetch_json(url):
    try:
        with urllib.request.urlopen(url) as resp:
            return json.load(resp)
    except Exception:
        return None

latest = fetch_json(f"https://api.github.com/repos/{repo}/releases/latest")
if latest and latest.get("tag_name"):
    print(latest.get("tag_name", ""))
    sys.exit(0)

releases = fetch_json(f"https://api.github.com/repos/{repo}/releases") or []
for rel in releases:
    if rel.get("draft") or rel.get("prerelease"):
        continue
    if rel.get("tag_name"):
        print(rel.get("tag_name"))
        sys.exit(0)

tags = fetch_json(f"https://api.github.com/repos/{repo}/tags") or []
if tags:
    print(tags[0].get("name", ""))
PY
)"
    fi

    if [[ -z "$OKIT_VERSION" ]]; then
        echo -e "${RED}✗ 无法获取最新版本号${NC}"
        exit 1
    fi

    ASSET_NAME="okit-${OKIT_VERSION}-macos-${ARCH}.zip"
    echo -e "${BLUE}ℹ️  版本: ${OKIT_VERSION}${NC}"
    echo -e "${BLUE}ℹ️  资源名: ${ASSET_NAME}${NC}"
    DOWNLOAD_URL="$(python3 - <<'PY' "$OKIT_VERSION" "$ASSET_NAME"
import json, sys, urllib.request
version = sys.argv[1]
asset = sys.argv[2]
repo = "dolphin-molt/okit"

def fetch_json(url):
    try:
        with urllib.request.urlopen(url) as resp:
            return json.load(resp)
    except Exception:
        return None

release = fetch_json(f"https://api.github.com/repos/{repo}/releases/tags/{version}")
if release:
    for item in release.get("assets", []):
        if item.get("name") == asset:
            print(item.get("browser_download_url", ""))
            sys.exit(0)

releases = fetch_json(f"https://api.github.com/repos/{repo}/releases") or []
for rel in releases:
    if rel.get("tag_name") != version:
        continue
    for item in rel.get("assets", []):
        if item.get("name") == asset:
            print(item.get("browser_download_url", ""))
            sys.exit(0)
PY
)"
    echo -e "${BLUE}ℹ️  下载地址: ${DOWNLOAD_URL}${NC}"

    if [[ -z "$DOWNLOAD_URL" ]]; then
        echo -e "${RED}✗ 未找到 Release 资源: $ASSET_NAME${NC}"
        exit 1
    fi

    TMP_DIR="$(mktemp -d)"
    ZIP_PATH="$TMP_DIR/$ASSET_NAME"
    echo -e "${BLUE}⬇️  下载: $ASSET_NAME${NC}"
    curl -L -o "$ZIP_PATH" "$DOWNLOAD_URL"

    if command -v unzip &> /dev/null; then
        unzip -q "$ZIP_PATH" -d "$TMP_DIR"
    else
        ditto -xk "$ZIP_PATH" "$TMP_DIR"
    fi

    if [[ ! -f "$TMP_DIR/okit" ]]; then
        echo -e "${RED}✗ 解压后未找到 okit 可执行文件${NC}"
        exit 1
    fi
    BINARY_SOURCE="$TMP_DIR/okit"
fi

# Install binary
echo -e "${BLUE}📥 安装到 $INSTALL_DIR/okit${NC}"
if [[ "$USE_SUDO" == true ]]; then
    sudo cp "$BINARY_SOURCE" "$INSTALL_DIR/okit"
    sudo chmod +x "$INSTALL_DIR/okit"
else
    cp "$BINARY_SOURCE" "$INSTALL_DIR/okit"
    chmod +x "$INSTALL_DIR/okit"
fi

# Create default registry.json if not exists
REGISTRY_FILE="$OKIT_DIR/registry.json"
if [[ ! -f "$REGISTRY_FILE" ]]; then
    echo -e "${BLUE}📝 创建默认配置${NC}"
    cat > "$REGISTRY_FILE" << 'EOF'
{
  "steps": [
    { "name": "Node.js", "install": "brew install node", "upgrade": "brew upgrade node", "uninstall": "brew uninstall node", "check": "command -v node" },
    { "name": "Git", "install": "brew install git", "upgrade": "brew upgrade git", "check": "command -v git" },
    { "name": "GitHub CLI", "install": "brew install gh", "upgrade": "brew upgrade gh", "uninstall": "brew uninstall gh", "check": "command -v gh" },
    { "name": "pnpm", "install": "brew install pnpm", "upgrade": "brew upgrade pnpm", "uninstall": "brew uninstall pnpm", "check": "command -v pnpm" },
    { "name": "Python", "install": "brew install python", "upgrade": "brew upgrade python", "uninstall": "brew uninstall python", "check": "command -v python3" },
    { "name": "Docker", "install": "brew install --cask docker", "upgrade": "brew upgrade --cask docker", "uninstall": "brew uninstall --cask docker", "check": "command -v docker" },
    { "name": "Codex CLI", "install": "npm install -g @openai/codex", "upgrade": "npm update -g @openai/codex", "uninstall": "npm uninstall -g @openai/codex", "check": "command -v codex" },
    { "name": "Claude Code", "install": "npm install -g @anthropic-ai/claude-code", "upgrade": "npm update -g @anthropic-ai/claude-code", "uninstall": "npm uninstall -g @anthropic-ai/claude-code", "check": "command -v claude" },
    { "name": "yt-dlp", "install": "brew install yt-dlp", "upgrade": "brew upgrade yt-dlp", "uninstall": "brew uninstall yt-dlp", "check": "command -v yt-dlp" },
    { "name": "curl", "install": "brew install curl", "upgrade": "brew upgrade curl", "uninstall": "brew uninstall curl", "check": "command -v curl" },
    { "name": "Playwright", "install": "npm install -g @playwright/test && npx playwright install", "upgrade": "npm update -g @playwright/test", "uninstall": "npm uninstall -g @playwright/test", "check": "command -v playwright" },
    { "name": "Mermaid CLI", "install": "npm install -g @mermaid-js/mermaid-cli", "upgrade": "npm update -g @mermaid-js/mermaid-cli", "uninstall": "npm uninstall -g @mermaid-js/mermaid-cli", "check": "command -v mmdc" },
    { "name": "Pandoc", "install": "brew install pandoc", "upgrade": "brew upgrade pandoc", "uninstall": "brew uninstall pandoc", "check": "command -v pandoc" },
    { "name": "ffmpeg", "install": "brew install ffmpeg", "upgrade": "brew upgrade ffmpeg", "uninstall": "brew uninstall ffmpeg", "check": "command -v ffmpeg" },
    { "name": "ImageMagick", "install": "brew install imagemagick", "upgrade": "brew upgrade imagemagick", "uninstall": "brew uninstall imagemagick", "check": "command -v convert" },
    { "name": "pipx", "install": "brew install pipx && pipx ensurepath", "upgrade": "brew upgrade pipx", "uninstall": "brew uninstall pipx", "check": "command -v pipx" },
    { "name": "Whisper", "install": "pipx install openai-whisper", "upgrade": "pipx upgrade openai-whisper", "uninstall": "pipx uninstall openai-whisper", "check": "command -v whisper" },
    { "name": "Jupyter", "install": "pipx install jupyter", "upgrade": "pipx upgrade jupyter", "uninstall": "pipx uninstall jupyter", "check": "command -v jupyter" },
    { "name": "DuckDB", "install": "brew install duckdb", "upgrade": "brew upgrade duckdb", "uninstall": "brew uninstall duckdb", "check": "command -v duckdb" },
    { "name": "ripgrep", "install": "brew install ripgrep", "upgrade": "brew upgrade ripgrep", "uninstall": "brew uninstall ripgrep", "check": "command -v rg" },
    { "name": "fzf", "install": "brew install fzf", "upgrade": "brew upgrade fzf", "uninstall": "brew uninstall fzf", "check": "command -v fzf" }
  ]
}
EOF
fi

# Check if install directory is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo -e "${YELLOW}⚠️  $INSTALL_DIR 不在 PATH 中${NC}"
    
    # Determine shell config file
    SHELL_CONFIG=""
    if [[ "$SHELL" == *"zsh"* ]]; then
        SHELL_CONFIG="$HOME/.zshrc"
    elif [[ "$SHELL" == *"bash"* ]]; then
        SHELL_CONFIG="$HOME/.bashrc"
    fi
    
    if [[ -n "$SHELL_CONFIG" ]]; then
        echo -e "${BLUE}📝 添加到 $SHELL_CONFIG${NC}"
        echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$SHELL_CONFIG"
        # 尝试立即生效
        export PATH="$INSTALL_DIR:$PATH"
        # shellcheck disable=SC1090
        source "$SHELL_CONFIG" || true
        echo -e "${GREEN}✓ PATH 已更新${NC}"
    fi
fi

# 尝试确保 pipx 的路径立即生效
if command -v pipx &> /dev/null; then
    export PATH="$HOME/.local/bin:$PATH"
fi

echo ""
echo -e "${GREEN}✓ OKIT v1 安装成功！${NC}"
echo ""
echo -e "${BLUE}使用方法:${NC}"
echo "  okit           启动交互式菜单"
echo "  okit upgrade   升级菜单"
echo "  okit uninstall 卸载 OKIT"
echo ""
echo -e "${BLUE}配置文件:${NC}"
echo "  $REGISTRY_FILE"
echo ""
echo -e "${BLUE}开始吧！${NC}"
echo "  okit"
