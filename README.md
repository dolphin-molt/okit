# README 草稿（批次 4 由 opencode 原样落盘到 okit/README.md）

> 注意：此文件是给 opencode 的交付物，不是最终文件本身。截图位用 HTML 注释占位。

---

# OKIT — AI Agent 的密钥与模型管控台

密钥与模型，一处掌控。OKIT 是一个本地优先的开源工具，管好 AI 编程 CLI（Claude Code、Codex、OpenCode 等 10 个 Agent）的密钥生命周期：**创建 → 保管 → 切换 → 验证 → 监控**。本地功能永久免费。

<!-- 截图位：主界面 /settings 快速启动页 -->

## 为什么是 OKIT

- **切换永不丢配置** — 外科手术式写入：只改 OKIT 自己拥有的字段，你的 hooks、statusLine、tui、MCP 配置原样保留。每次切换前自动快照，设置页一键对比与回滚。
- **切模型不离开 Codex** — 自动生成 Codex 原生模型目录（model-catalogs），在 Codex CLI 里 `/model` 直接切换，不用回到 OKIT。
- **零常驻、零侵入** — 没有后台进程、不在请求路径上：OKIT 写完配置就退出，你的 Agent 直连模型平台。卸载不留痕，配置照常工作。
- **密钥保险库** — AES-256-GCM 本地加密存储，绑定项目后自动注入 `.env`，支持云端同步与局域网点对点同步（配对码配对）。

## 与同类工具对比

| 能力 | OKIT | cc-switch | codex-router |
|------|------|-----------|--------------|
| 配置写入 | 字段级合并 + 切换前快照/回滚 | 全量覆盖 + 通用配置片段 | managed block |
| 常驻进程 | 无 | 托盘（代理可选） | 本地网关（必须） |
| 支持 Agent | 10 个 | 8 个 | Codex 系 |
| 密钥管理 | 加密 vault + 项目绑定 | 本地明文配置 | 凭证隔离 |
| 自动创建 API Key | 31 个平台（浏览器扩展） | — | — |
| 用量查询 | 15 个平台官方 API 直查 | 代理层统计 | — |
| 平台 | macOS / Linux / Windows | macOS / Linux / Windows | macOS / Linux / Windows |

## 快速开始

```bash
# npm 安装（即将发布）
npm install -g okit

# 或从源码
git clone https://github.com/Cing-self/okit.git
cd okit
npm ci --ignore-scripts
npm run build
node dist/main.js web
# 打开 http://localhost:3780
```

常用命令：

```bash
okit web                              # 启动 Web 管理台（:3780）
okit vault set <key>                  # 存密钥（AES-256-GCM 加密）
okit vault inject                     # 输出 export 语句（配合 eval）
okit provider list                    # 列出 29+ 预置模型平台
okit provider switch                  # 交互式切换 Agent 的 Provider/模型
okit provider use <provider>          # 非交互式切换（脚本/Agent 友好）
okit hook install                     # cd 进项目自动注入密钥到 shell
```

## 功能总览

- **密钥库**：加密存储、脱敏展示、项目绑定（`.okitenv` → `.env`）、shell 钩子自动注入、云同步 + 局域网同步
- **Provider/模型管控**：29+ 平台预置（官方/聚合/国内），10 个 Agent 适配器，多端点协议（anthropic/openai 兼容），认证状态检测，订阅/API/第三方三模式凭证管理
- **一键创建 Key**：浏览器扩展在官方控制台内自动填表创建并回填（支持 31 个平台，含火山引擎、智谱、百度千帆等）
- **用量查询**：15 个平台官方 API 直查订阅余额/用量，阈值告警（本地通知；Cloud Pro 可远程 Webhook）
- **模型目录**：全平台官方定价与能力数据（输入/输出/缓存价、上下文窗口），峰谷价直呈
- **Cloud Pro（可选订阅）**：跨设备用量历史 + 远程 Webhook 告警。本地功能永久免费，云端只上传用量数字，API Key 永不上传

## 开发

```bash
npm ci --ignore-scripts     # 安装依赖（postinstall 需 dist，故忽略）
npm run build               # tsc + 预设生成 + web 拷贝 + 前端构建
npx vitest run              # 测试（500+ 用例）
cd src/web/frontend && npm run dev   # 前端开发服务器（:5173 → 代理 :3780）
```

要求 Node.js 20+。前端 React + TypeScript + Vite；后端 Node（web 层 CommonJS）；测试 vitest。

## 文档

- [用户手册](docs/user-manual.md)（[English](docs/user-manual.en.md)）
- [模型定价与能力数据](docs/model-pricing-and-capabilities.md)
- [贡献指南](CONTRIBUTING.md)

## License

<!-- LICENSE-TBD：待定稿后替换 -->
待定。