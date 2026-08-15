# OKIT 使用手册

OKIT 是 AI Agent 的密钥与模型管控台：本地加密密钥库、内置 29+ 模型平台、适配 8 个 Agent、15 平台用量查询，配合浏览器扩展可以**一键自动创建 API Key**。

---

## 1. 安装与启动

**NPM 安装（推荐）：**

```bash
npm install -g @cing-self/okit-cli
```

**脚本安装：**

```bash
curl -fsSL https://raw.githubusercontent.com/dolphin-molt/okit/refs/heads/main/install.sh | bash
```

**启动 Web 控制台：**

```bash
okit            # 交互式菜单
okit web        # 启动 Web Dashboard
```

Web 控制台默认运行在 **http://localhost:3780**。如果 3780 被占用会自动尝试 3781、3782……启动日志会打印实际地址。

> ⚠️ **要使用浏览器扩展（自动创建密钥），OKIT 必须运行在 3780 端口**。扩展当前版本硬编码连接 `ws://localhost:3780/ws/extension`，如果 OKIT 落在 3781 等端口，扩展将无法连接。遇到这种情况，先关掉占用 3780 的进程再重启 OKIT。

---

## 2. 控制台总览

| 页面 | 用途 |
|------|------|
| 快速启动 | 首页驾驶舱：Agent 切换、Provider 启用、今日用量 |
| AI 助手 | 内置助手，在密钥/平台/用量上下文中对话执行操作 |
| 密钥管理 | 加密密钥库：手动添加、自动创建、绑定项目、云同步 |
| 模型管控 | 29+ Provider 预设：端点、认证方式、模型列表、套餐 |
| 用量统计 | 15 个平台的订阅/余额查询与告警 |
| Agent 配置 | 8 个 Agent 的配置适配与模型一键切换 |
| 设置 | 语言、云同步、端口等 |

---

## 3. 浏览器扩展配置（自动创建密钥的前提）

扩展 **OKIT Auto-Create**（MV3）复用 Chrome 已登录的平台会话，在官方控制台里替你点表单、创建 Key、复制并回填到 OKIT 加密库——全程只在你的浏览器和本机之间进行。

### 3.1 构建扩展

仓库里的扩展源码在 `extension/`，需要先构建出 `dist/` 目录：

```bash
cd extension
npm install
npm run build        # tsc 编译 → extension/dist/
```

### 3.2 加载到 Chrome

1. 打开 `chrome://extensions/`
2. 右上角开启**开发者模式**
3. 点击**加载已解压的扩展程序**
4. 选择 `extension/dist/` 目录（注意是 `dist` 子目录，不是 `extension` 根目录）

加载成功后扩展列表会出现 "OKIT Auto-Create"。

### 3.3 确认连接

1. 启动 OKIT（`okit web`，确认在 3780 端口）
2. 扩展会自动通过 WebSocket 连接 `ws://localhost:3780/ws/extension`
3. OKIT 启动日志出现 `[WS] Extension hello: v2.x.x protocol=...` 即连接成功
4. 也可以在控制台**密钥管理 → 自动创建**入口查看扩展状态

### 3.4 权限说明（重要）

扩展申请了 `debugger`、`tabs`、`cookies` 等权限，因此 Chrome 顶部会显示**"OKIT Auto-Create 已开始调试此浏览器"**的信息条——**这是正常现象**：扩展需要 debugger 通道读取页面内容与执行点击。调试只发生在本机 OKIT 与你的浏览器之间，不会向任何外部服务器发送数据。

### 3.5 更新扩展

- 扩展代码更新后：重新 `npm run build`，再到 `chrome://extensions/` 点扩展卡片上的 🔄 刷新
- 若 `manifest.json` 的 `permissions` 有改动：必须**移除扩展 → 重新加载已解压的扩展程序**，仅刷新无效

---

## 4. 自动创建密钥

### 4.1 前提

- 已按第 3 节装好扩展并确认连接
- **Chrome 已登录目标平台**（自动创建复用你的登录会话）

### 4.2 操作流程

1. 控制台 → **密钥管理** → **自动创建**
2. 选择平台（当前支持 31 个，见下表）
3. OKIT 会打开浏览器窗口，自动进入该平台的 API Key 页面，填名称、点创建、复制新 Key
4. Key 自动写入本地加密库（AES-256-GCM），全程不落明文

### 4.3 支持的平台

| 分类 | 平台 |
|------|------|
| 国际 | OpenAI、Anthropic、Cloudflare、xAI (Grok)、Mistral、OpenRouter |
| 智谱系 | 智谱 AI（国内站）、Z.AI（国际站） |
| 火山引擎 | 火山引擎、火山引擎 Agent Plan |
| 腾讯云 | 腾讯云、腾讯云 Token Plan |
| MiniMax | MiniMax 国内/国际站、MiniMax Token Plan 国内/国际 |
| 月之暗面 | Moonshot、Moonshot Coding Plan、Kimi 国内站、Kimi 国际站 |
| 阿里云 | 阿里云百炼、百炼 Coding Plan、百炼 Token Plan |
| 百度 | 百度千帆、千帆 Token Plan |
| 其他 | DeepSeek、硅基流动、小米 MiMo（及 Token Plan）、阶跃星辰、OpenCode Go |

### 4.4 特殊情况

- **火山引擎**：创建过程中平台可能弹出安全验证或短信验证码，需要你手动完成验证，之后扩展继续接管（半自动）
- **Z.AI / 百度千帆 Token Plan**：依赖列表页的"复制"控件读取明文；个别情况下控件不返回明文，OKIT 会明确提示**停止写入并要求手动复制**——宁可不存，也不把掩码存进库
- **Anthropic**：创建后需要保持浏览器在前台，扩展通过"复制"按钮读取 Key

---

## 5. 密钥库日常使用

- **手动添加**：密钥管理 → 添加，填名称与 Key，可选填用途说明
- **绑定项目**：密钥可绑定到项目目录，OKIT 自动把 Key 注入该项目的 `.env`（如 `OPENAI_API_KEY`），按密钥名精确匹配
- **云同步**：基于 Cloudflare KV 的端到端加密同步。在设置中配置后：
  ```bash
  okit vault push     # 推送密钥到云端
  okit vault pull     # 从云端拉取
  ```
  云端只存密文，主密钥始终在本机。

---

## 6. 模型平台与 Agent 配置

- **模型管控**页内置 29+ Provider 预设（官方 API、聚合平台、国内平台），点卡片即可配置端点与认证；右上角三点菜单支持"连接"（测试 + 拉取模型列表）
- **Agent 配置**支持 8 个 Agent：Claude Code、ChatGPT (Codex)、Kimi Code、WorkBuddy、Hermes、OpenCode、OpenClaw、ZCode
- 切换模型：快速启动页选 Agent → 打开对应 Provider 开关 → 点模型 chip 即完成切换，配置文件（`config.toml`、`auth.json` 等）自动写对
- Provider 配置支持导入/导出，方便跨设备迁移

---

## 7. 用量查询

- **用量统计**页展示各平台订阅套餐的剩余量（按 5h/周/月窗口）与充值余额
- 智能轮询自动刷新；剩余量 ≤30% 黄色告警、≤10% 红色告警，并触发浏览器通知
- 首页"快速启动"也有今日用量摘要条

---

## 8. CLI 速查

```bash
okit                    # 交互式菜单
okit web                # 启动 Web Dashboard
okit vault              # 密钥管理
okit vault push         # 加密同步密钥到云端
okit vault pull         # 从云端拉取密钥
okit auth               # 检查工具授权状态
okit upgrade            # 升级 OKIT
okit -V                 # 查看版本
```

---

## 9. 常见问题

**Q：扩展装好了但连不上？**
确认 OKIT 运行在 3780 端口（看启动日志）。扩展硬编码连接 3780；若 OKIT 落在 3781+，扩展无法连接。

**Q：Chrome 顶部"正在调试此浏览器"的信息条能关吗？**
关闭它扩展即断开。这个信息条是 Chrome 对 debugger 权限的强制提示，属于正常现象，保持开启即可。

**Q：自动创建到一半停了？**
多数情况是平台弹出了验证（安全验证/短信）。手动完成验证后流程会继续；或重新发起自动创建。

**Q：密钥库里看不到完整 Key？**
密钥以 AES-256-GCM 加密存储，界面默认脱敏展示。绑定项目后运行时自动注入明文；也可以在需要时查看完整值。

**Q：支持 Windows / Linux 吗？**
支持。OKIT 与扩展在 macOS、Linux、Windows 上均可运行。
