# OKIT

Agent 基础设施运维工具，集中管理工具安装、授权、密钥与中继连接，消除 Agent 执行中断。

适合场景：
- Agent 运行时自动安装缺失的 CLI 工具
- 统一管理 API Key，按项目注入环境变量
- 通过中继服务器让外部 Agent 访问本地服务
- Web Dashboard 可视化管理一切
- 团队共享工具配置 Profile

---

## 安装

**NPM（推荐）**：

```bash
npm install -g okit-cli
```

**脚本安装**：

```bash
curl -fsSL https://raw.githubusercontent.com/dolphin-molt/okit/refs/heads/main/install.sh | bash
```

安装完成后：

```bash
okit                    # 交互式菜单
okit web                # 启动 Web Dashboard
```

---

## 常用命令

```bash
okit                    # 交互式菜单
okit check              # 检查所有工具安装与授权状态
okit upgrade            # 升级 OKIT 或工具
okit uninstall          # 卸载 OKIT
okit profile            # 工具分组管理
okit auth               # 检查工具授权状态
okit auth --fix         # 自动修复授权
okit vault              # 密钥管理
okit vault push         # 加密同步密钥到云端
okit vault pull         # 从云端拉取密钥
okit relay              # 中继服务器连接
okit repo               # Git/GitHub 设置
okit claude             # Claude 配置管理
okit hook               # Shell 自动注入 Hook
okit web                # 启动 Web Dashboard
okit -V                 # 查看版本
```

---

## Web Dashboard

一键启动可视化控制台：

```bash
okit web                # 默认 http://localhost:3000
okit web --port 8080    # 指定端口
```

功能覆盖：

- **工具管理** — 浏览、安装、升级、卸载 76+ 工具
- **密钥管理** — 可视化 Vault，增删改查密钥，关联项目
- **授权管理** — 查看所有工具的登录/授权状态
- **云同步** — 配置 Supabase / Cloudflare 等平台，加密同步密钥
- **监控面板** — 磁盘用量分析，AI 智能清理建议
- **Agent 对话** — 内置 AI Agent 交互界面
- **操作日志** — 实时查看所有操作记录
- **设置中心** — 语言、同步平台、中继服务器配置

---

## Profile — 工具分组

自定义工具组合，一键安装，支持团队共享：

```bash
okit profile create     # 创建 Profile
okit profile apply      # 安装 Profile 中的所有工具
okit profile list       # 查看所有 Profile
okit profile export     # 导出（分享给团队）
okit profile import     # 导入
okit profile delete     # 删除
```

Profile 存储在 `~/.okit/profiles/`。

---

## Auth — 授权管理

检查所有工具的登录/授权状态，一键修复：

```bash
okit auth               # 检查授权状态
okit auth --fix         # 自动运行 gh auth login、docker login 等
```

支持 15+ 工具的授权检测与修复（gh、docker、wrangler、vercel、aws、gcloud 等）。

---

## Vault — 密钥管理

AES-256-GCM 加密存储 API Key，按项目注入环境变量：

```bash
okit vault set OPENROUTER_KEY         # 保存密钥
okit vault set KEY/company value      # 多别名（同一 Key 不同账号）
okit vault list                        # 查看所有密钥
okit vault get OPENROUTER_KEY          # 输出原始值
okit vault delete OPENROUTER_KEY       # 删除密钥
okit vault inject                      # 输出 export 语句
okit vault env                         # 生成 .env 文件
okit vault where OPENROUTER_KEY        # 查看密钥被哪些项目使用
okit vault sync                        # 同步到所有绑定项目
```

### 密钥映射

在项目根目录创建 `.okitenv` 文件，将 Vault 中的密钥映射为框架需要的环境变量名：

```
OPENAI_API_KEY: OPENROUTER_KEY
GITHUB_TOKEN: GITHUB_TOKEN/company
DATABASE_URL
```

格式：`环境变量名: Vault密钥名[/别名]`，支持多别名。

### Shell Hook 自动注入

```bash
okit hook install      # 安装 Shell Hook（支持 zsh/bash/PowerShell）
okit hook status       # 查看安装状态
okit hook uninstall    # 卸载
```

安装后，每次 `cd` 到含 `.okitenv` 的目录时自动注入环境变量，离开时自动清理。

### 使用方式

```bash
# 手动注入到当前 shell
eval "$(okit vault inject)"

# 生成 .env 文件
okit vault env

# 自动注入（推荐）
okit hook install
```

---

## Vault 云同步

加密备份密钥到云端，多设备同步：

```bash
okit vault push                        # 加密推送所有密钥到云端
okit vault pull                        # 从云端拉取并合并
okit vault test supabase               # 测试平台连接
```

支持平台：

| 平台 | 说明 |
|------|------|
| Supabase | PostgreSQL + Auth |
| Cloudflare KV | Key-Value 存储 |
| Cloudflare D1 | SQLite 数据库 |
| Cloudflare R2 | 对象存储 |
| 火山引擎 KMS | 密钥管理服务 |

同步流程使用 AES-256-GCM 端到端加密，密钥仅保存在本地，云端只存密文。

---

## Relay — 中继服务器

通过 Cloudflare Worker 中继，让外部 Agent 访问本地服务，无需开放端口：

```bash
okit relay config                      # 配置中继 URL 和 Token
okit relay connect                     # 建立连接（前台运行）
okit relay daemon                      # 后台守护进程模式
okit relay agents                      # 查看在线 Agent
okit relay ps                          # 查看运行中的守护进程
okit relay logs <agent>                # 查看日志
okit relay token <agent>               # 获取访问 Token
okit relay stop                        # 停止守护进程
okit relay status                      # 查看隧道状态
```

工作原理：

```
本地服务 ──WebSocket出站──→ Cloudflare Worker ←──HTTP── 外部调用者
          (不开端口)           (公网入口)
```

支持三种适配器模式：
- **OpenClaw** — 通用 Agent 运行时
- **Claude** — Claude Code 专用
- **Codex** — OpenAI Codex 专用

外部调用示例：

```bash
curl https://<relay-url>/agent/<agent-name>/api/data \
  -H "Authorization: Bearer <token>"
```

---

## 工具注册表

内置 76+ 常用工具，覆盖：

- **基础开发**：Node.js、Python、Git、Docker、Bun
- **包管理**：Homebrew、pnpm、uv、pipx
- **云平台**：AWS CLI、gcloud、Azure CLI、Wrangler、Vercel、Netlify
- **部署**：Railway、Supabase、Firebase、Fly.io、Heroku
- **AI 工具**：Claude Code、Gemini CLI、Codex CLI、Ollama、Happy Coder
- **实用工具**：jq、httpie、bat、tree、ngrok、cloudflared、fzf、tmux
- **终端工具**：iTerm2、Warp、Raycast

自定义工具可通过 `~/.okit/registry.json` 添加。

---

## 配置文件

| 文件 | 用途 |
|------|------|
| `~/.okit/user.json` | 用户偏好、凭据、中继配置 |
| `~/.okit/registry.json` | 自定义工具注册表 |
| `~/.okit/profiles/` | Profile 配置 |
| `~/.okit/vault/` | AES-256-GCM 加密密钥存储 |
| `~/.okit/logs/` | 操作日志（JSONL 格式） |
| `.okitenv` | 项目级密钥映射 |

---

## 开发

```bash
git clone https://github.com/dolphin-molt/okit.git
cd okit
npm install
npm run build           # 构建
npm test                # 运行测试（80 个用例）
npm run dev             # 本地开发
npm link                # 全局链接到本地代码
```

---

## 许可证

MIT
