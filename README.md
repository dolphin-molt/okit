# OKIT

Agent 基础设施运维工具，集中管理工具安装、授权、密钥与中继连接，消除 Agent 执行中断。

适合场景：
- Agent 运行时自动安装缺失的 CLI 工具
- 统一管理 API Key，按项目注入环境变量
- 通过中继服务器让外部 Agent 访问本地服务
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
okit
```

---

## 常用命令

```bash
okit                    # 交互式菜单
okit check              # 检查所有工具安装状态
okit upgrade            # 升级 OKIT 或工具
okit uninstall          # 卸载 OKIT
okit profile            # 工具分组管理
okit auth               # 检查工具授权状态
okit auth --fix         # 自动修复授权
okit vault              # 密钥管理
okit relay              # 中继服务器连接
okit repo               # Git/GitHub 设置
okit claude             # Claude 配置管理
okit -V                 # 查看版本
```

---

## Profile — 工具分组

自定义工具组合，一键安装：

```bash
okit profile create     # 创建 Profile
okit profile apply      # 安装 Profile 中的所有工具
okit profile list       # 查看所有 Profile
okit profile export     # 导出（分享给团队）
okit profile import     # 导入
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

加密存储 API Key，按项目注入环境变量：

```bash
okit vault set OPENROUTER_KEY         # 保存密钥
okit vault list                        # 查看所有密钥
okit vault get OPENROUTER_KEY          # 输出原始值
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

格式：`环境变量名: Vault密钥名`，支持 `KEY/alias` 多别名。

### 使用方式

```bash
# 注入到当前 shell
eval "$(okit vault inject)"

# 生成 .env 文件
okit vault env
```

---

## Relay — 中继服务器

通过 Cloudflare Worker 中继，让外部 Agent 访问本地服务，无需开放端口：

```bash
okit relay config                      # 配置中继 URL 和 Token
okit relay connect                     # 建立连接
okit relay agents                      # 查看在线 Agent
okit relay status                      # 查看隧道状态
```

工作原理：

```
本地服务 ──WebSocket出站──→ Cloudflare Worker ←──HTTP── 外部调用者
          (不开端口)           (公网入口)
```

外部调用示例：

```bash
curl https://<relay-url>/agent/<agent-name>/api/data \
  -H "Authorization: Bearer <token>"
```

---

## 工具注册表

内置 54+ 常用工具，覆盖：

- **基础开发**：Node.js、Python、Git、Docker
- **包管理**：Homebrew、pnpm、uv、pipx
- **云平台**：AWS CLI、gcloud、Azure CLI、Wrangler、Vercel、Netlify
- **部署**：Railway、Supabase、Firebase、Fly.io、Heroku
- **AI 工具**：Claude Code、Ollama
- **实用工具**：jq、httpie、bat、tree、ngrok、cloudflared

自定义工具可通过 `~/.okit/registry.json` 添加。

---

## 配置文件

| 文件 | 用途 |
|------|------|
| `~/.okit/user.json` | 用户偏好、凭据、中继配置 |
| `~/.okit/registry.json` | 自定义工具注册表 |
| `~/.okit/profiles/` | Profile 配置 |
| `~/.okit/vault/` | 加密密钥存储 |
| `.okitenv` | 项目级密钥映射 |

---

## 开发

```bash
npm run dev             # 本地开发
npm run build           # 构建
```

---

## 许可证

MIT
