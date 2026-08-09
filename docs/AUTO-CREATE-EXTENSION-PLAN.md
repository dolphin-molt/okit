# OKIT 自动创建密钥 — Chrome 扩展 v2 实施计划

> 本文档交接给下一个实施者。完整描述：业务背景、为什么前方案失败、要做什么、怎么做、按什么顺序做。

---

## 0. TL;DR

**目标**：让 OKIT 桌面版在不要求用户扫码登录的前提下，通过 Chrome 扩展复用用户日常 Chrome 里已登录的 cookie，一键在 10+ AI 平台自动创建 API key 并回填 OKIT vault。

**做法**：参考 [opencli](https://github.com/jackwener/opencli) 的扩展方案，从零做一个高质量 Chrome 扩展（MV3，TypeScript）+ 在 OKIT 加常驻 daemon。opencli 已经把这条路走通，我们抄过来即可。

**总工作量**：约 6-8 小时代码、2 小时调试。分 4 个阶段，每阶段都有明确验收。

---

## 1. 业务背景

### 1.1 用户场景

OKIT 是用户的桌面端工具，用来管理各种 AI 平台的 API key。当前有个痛点：**每个新平台的 key 都要手动登录平台后台 → 创建 → 复制回来**。如果要让其他用户的 agent 也能一句话创建，必须做成自动化。

用户场景：
1. 用户在 OKIT 桌面端点「⚡ 自动创建密钥」→ 选平台 → 拿回 key 回填 vault
2. 用户的 agent（如 Claude）说：「帮我在 zhipu 建一个 key」 → agent 调 OKIT → 完成
3. 用户日常 Chrome 里已经登录了 zhipu/volcengine/minimax/openai 等平台 → 期望 OKIT 直接复用这些登录态

### 1.2 业务约束

- **桌面端**：OKIT 是 Electron 包装的桌面应用（不是 web 后台），单机单用户使用
- **分发模式**：用户从 GitHub release 下载 OKIT 安装包
- **10+ 平台**：zhipu、volcengine、minimax、openai、anthropic、google、huggingface、openrouter 等
- **不能要求用户为每个平台扫码登录**

---

## 2. 历史方案与失败原因

### 2.1 Playwright state-file 方案（已放弃）

**做法**：每个平台首次用 Playwright Chromium 扫码登录，cookie 保存到 `~/.okit/auto-create/<platform>-state.json`，后续秒出。

**Playwright 实现进度**（参见 `src/scripts/auto-create-key.mjs`）：
- ✅ zhipu：网络拦截拿到完整 key
- ⚠️ volcengine：卡在「直接创建」选择弹窗
- ⏸ minimax：未验证（之前扩展拿到的是构建文件 hash）

**为什么放弃**：
- 每个用户每平台首次要扫码 30 秒，不适合桌面版长期分发
- 跟用户日常 Chrome 登录态是两套，desktop UX 不好
- 沙箱里也跑不稳

### 2.2 Chrome 扩展 v1（已失败）

**做法**：做了完整 Chrome 扩展（`/Users/dolphin/Desktop/Dolphin/okit/extension/`），WebSocket 跟 OKIT server 通讯，通过 `chrome.debugger` 控制用户的 Chrome 标签页。

**已实现的文件**：
- `extension/manifest.json`（MV3, 当前 version 1.2.1）
- `extension/background.js`（~700 行，命令处理、CDP attach、key 提取）
- `extension/icons/icon{16,48,128}.png`

**为什么失败**（4 个关键缺失）：

| 缺失 | 现象 | 后果 |
|------|------|------|
| **无 SW keepalive** | Chrome 5 分钟 idle 杀 SW | WebSocket 断，扩展跟 OKIT 失去联系 |
| **无 attach 容错** | `chrome.debugger.attach` 失败直接放弃 | 第一次不行就永久不行 |
| **无 anti-detection** | 智谱/火山/MiniMax 网站 fingerprint 检测 | 创建按钮找不到、key 提取拿到的是噪音 |
| **stealth 注入时机错** | 在 `Runtime.evaluate` 后注入 stealth JS | 等页面跑完再 patch 太晚，网站已经检测到 CDP |
| **无 network getResponseBody** | 没抓 API 响应里的完整 key | 拿到的是 truncated key（`eyJ***...`） |

**还有一个隐性踩坑**：Chrome 的 service worker 缓存顽固——改 `background.js` 文件后点扩展的「🔄 刷新」**不重载文件**，必须升 `manifest.json` 的 `version` 字段才会强制重载。我们当时连升 7 次版本号。

---

## 3. opencli 调研结论

**[opencli](https://github.com/jackwener/opencli)** 是 GitHub 上一个开源 CLI 工具，把任何网站 / Electron App / 本地工具变成 CLI 命令。它的浏览器自动化部分已经走通了这条路，是我们要抄的对象。

### 3.1 opencli 的架构

```
┌─────────────────────────────────────────────────────┐
│ opencli daemon (Node 常驻进程)                        │
│   - micro-daemon, port 19825                          │
│   - /ping 健康端点                                    │
│   - /ext WebSocket 服务端                             │
└──────────────────────┬───────────────────────────────┘
                       │ WebSocket
                       ▼
┌─────────────────────────────────────────────────────┐
│ Chrome 扩展 (MV3 Service Worker)                      │
│   - WebSocket client                                  │
│   - chrome.alarms keepalive (24s)                     │
│   - chrome.debugger 容错 attach                       │
│   - Page.addScriptToEvaluateOnNewDocument 注入 stealth │
└──────────────────────┬───────────────────────────────┘
                       │ chrome.debugger
                       ▼
┌─────────────────────────────────────────────────────┐
│ 用户 Chrome 标签页 (Bilibili/知乎/zhipu/...)         │
│   - 已登录的 cookie                                   │
│   - stealth JS 在每个新页面加载前注入                  │
└─────────────────────────────────────────────────────┘
```

### 3.2 opencli 扩展关键模块

代码位置：`/Users/dolphin/Desktop/Dolphin/opencli/extension/src/`

| 文件 | 行数 | 用途 |
|------|------|------|
| `background.ts` | 878 | WS 重连、workspace 窗口管理、命令派发 |
| `cdp.ts` | 440 | chrome.debugger 容错 attach、网络抓包 |
| `stealth.ts`（在 src/browser/） | 354 | 6 维 anti-detection JS 生成 |
| `protocol.ts` | 87 | 命令/响应协议定义 |

### 3.3 opencli 关键技术 5 件（**我们缺的就是这些**）

#### ① SW keepalive
```typescript
// background.ts:235
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }); // ~24 seconds
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') void connect();
});
```

#### ② attach 容错
```typescript
// cdp.ts:60 - 5 次重试 + 500-1500ms 间隔 + URL 黑白名单 + 强制 detach
const MAX_ATTACH_RETRIES = aggressiveRetry ? 5 : 2;
for (let attempt = 1; attempt <= MAX_ATTACH_RETRIES; attempt++) {
  try {
    try { await chrome.debugger.detach({ tabId }); } catch { /* ignore */ }
    await chrome.debugger.attach({ tabId }, '1.3');
    break;
  } catch (e) {
    if (attempt < MAX_ATTACH_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}
```

#### ③ stealth 在页面加载前注入（**最关键的技术点**）
```typescript
// /Users/dolphin/Desktop/Dolphin/opencli/src/browser/cdp.ts:75
await this.send('Page.addScriptToEvaluateOnNewDocument', {
  source: generateStealthJs()
});
```
不是 `Runtime.evaluate` 后注入——**等页面跑完再 patch 太晚了**，网站加载第一时间就跑 stealth。

#### ④ 6 维 anti-detection JS（详见 opencli `stealth.ts`）
1. `navigator.webdriver` → `false`
2. `window.chrome` stub（runtime/loadTimes/csi）
3. `navigator.plugins` 注入 5 个 PDF Viewer（仅当空时）
4. `navigator.languages` 注入 `['en-US','en']`
5. `Permissions.query` notifications 走修复路径
6. 清理 `cdc_*` / `__playwright*` / `__puppeteer*` 全局

#### ⑤ Network.enable + getResponseBody 抓 API
```typescript
// cdp.ts:325
await chrome.debugger.sendCommand({ tabId }, 'Network.enable');

// 然后监听 Network.responseReceived，用 Network.getResponseBody 拿 body
// 这能拿到平台 API 响应里完整的 key（智谱就是这样，response 里直接是 eyJ... 完整 JWT）
```

### 3.4 opencli 跟我们 v1 扩展的对比

| 维度 | opencli | 我们 v1 |
|------|---------|---------|
| **核心技术** | chrome.debugger.attach | **一模一样** |
| **SW 防杀** | alarms keepalive | ❌ 无 |
| **attach 容错** | 5 次重试 + detach 清理 | ❌ 单次失败就放弃 |
| **anti-detection** | 6 维 + 新页面加载前注入 | ❌ 无 |
| **Network.getResponseBody** | 有 | ❌ 无 |
| **总投入** | 1700+ 行 TS | ~700 行 JS |

**结论**：技术上完全可行，跟 v1 同一条路线。v1 失败纯粹是工程量没到位——不是这条路走不通。

---

## 4. 实施方案

### 4.1 架构

```
┌─────────────────────────────────────────────────────────┐
│ OKIT 桌面应用 (Electron)                                  │
│                                                            │
│   ┌────────────────────────────┐                          │
│   │ okit daemon 常驻进程        │ <-- 新增                 │
│   │ (Electron 启动时拉起)       │                          │
│   │  - WebSocket 服务端         │                          │
│   │  - /ws/extension           │                          │
│   │  - /api/vault/auto-create  │                          │
│   └────────────────┬───────────┘                          │
│                    │                                       │
│   ┌────────────────▼─────────────────┐                    │
│   │ OKIT Web UI (localhost:3780)     │  <-- 已有           │
│   │ 用户在这里点「⚡ 自动创建密钥」  │                    │
│   └─────────────────────────────────┘                    │
└─────────────────────┬────────────────────────────────────┘
                      │ WebSocket
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Chrome 扩展 (用户首次手动安装一次)                          │
│   - MV3, TypeScript                                       │
│   - SW keepalive (chrome.alarms 24s)                      │
│   - chrome.debugger 容错 attach                           │
│   - Page.addScriptToEvaluateOnNewDocument 注入 stealth     │
│   - Network.enable + getResponseBody 抓 API 响应         │
└─────────────────────┬────────────────────────────────────┘
                      │ chrome.debugger
                      ▼
┌─────────────────────────────────────────────────────────┐
│ 用户 Chrome 标签页                                          │
│   - 已登录的平台（zhipu / volcengine / minimax / ...）     │
│   - stealth JS 在每个新页面加载前注入                       │
└─────────────────────────────────────────────────────────┘
```

### 4.2 工程决策

#### 决策 A：用 TypeScript 而非 JavaScript

opencli 用 TypeScript 写的，我们也用 TS。原因：
- background.js 700+ 行已经难维护
- 模块拆分需要清晰接口
- TS 编译产物是单文件 `dist/background.js`，扩展可直接引用

**TypeScript 编译**：用 `tsc --target ES2020 --module ESNext` 输出 ESM 模块。

#### 决策 B：去掉 workspace 多用户隔离（因为是单机桌面端）

opencli 的 workspace session（每个用户一个窗口）对我们是**过度设计**：
- 单机只跑一个 OKIT 实例
- 一台机器就一个用户
- **简化为一个 daemon + 一个常驻 automation 窗口**，30s idle 关

注：Phase 3 之前保持这个简化设计。如果未来要做 OKIT web 才需要 workspace。

#### 决策 C：扩展打包为单文件夹（不走 Chrome Web Store）

为了让用户能直接用，扩展以 `extension/` 文件夹形态分发，用户手动：
1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点「加载已解压的扩展程序」选 `extension/dist/`

打包分发的 `okit-extension.zip`（带 README + 一键安装脚本）是后续工作。

---

## 5. 实施阶段（4 阶段，渐进推进）

### Phase 1：扩展核心骨架（让 zhipu 跑通）

**目标**：扩展能装、能连 OKIT、能跑通 zhipu 平台拿到真 key。

**涉及文件**：

| 文件 | 操作 |
|------|------|
| `extension/manifest.json` | 改写，permissions 加 `scripting`，version 改成 2.0.0 |
| `extension/tsconfig.json` | 新建 |
| `extension/package.json` | 新建（devDeps: typescript, @types/chrome） |
| `extension/src/protocol.ts` | 从 opencli 抄 87 行协议定义 |
| `extension/src/cdp.ts` | 从 opencli 抄 attach 容错（不带 Network 抓包） |
| `extension/src/background.ts` | 重写：WS 重连 + SW keepalive (alarms) + 命令派发 |
| `extension/src/stealth.ts` | 从 opencli 抄 generateStealthJs |
| `extension/dist/background.js` | tsc 编译产物 |
| `extension/icons/icon{16,48,128}.png` | 已有 |

**OKIT 侧**（如果有改动）：
- `src/web/api/ws-extension.js`：跟扩展通讯的 WebSocket 服务端（已有，需增强）
- `src/web/api/auto-create.js`：把 Playwright 改回走扩展通道
- `src/scripts/auto-create-key.mjs`：先不动（Phase 3 才用）

**Phase 1 验收标准**：
1. `extension/dist/` 编译产出
2. 扩展装到 Chrome 后，控制台能看到 `[OKIT] Connected to daemon`
3. OKIT 端点 `POST /api/vault/auto-create {platform: 'zhipu', tokenName: 'test'}` 返回**完整的 zhipu JWT key**（`eyJ...` 完整，长度 > 100）
4. 智谱AI 页面创建完成后**真实的 key** 出现在 OKIT vault 里

**Phase 1 关键代码点**：

```typescript
// extension/src/background.ts
import { DAEMON_WS_URL, DAEMON_PING_URL, WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from './protocol';

let ws: WebSocket | null = null;
let reconnectAttempts = 0;

chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') connect();
});

async function connect() {
  try {
    await fetch(DAEMON_PING_URL, { signal: AbortSignal.timeout(1000) });
  } catch {
    scheduleReconnect();
    return;
  }
  ws = new WebSocket(DAEMON_WS_URL);
  ws.onopen = () => {
    reconnectAttempts = 0;
    ws?.send(JSON.stringify({ type: 'hello', version: chrome.runtime.getManifest().version }));
  };
  ws.onmessage = async (event) => {
    const cmd = JSON.parse(event.data);
    const result = await handleCommand(cmd);
    ws?.send(JSON.stringify(result));
  };
  ws.onclose = () => { ws = null; scheduleReconnect(); };
}

function scheduleReconnect() {
  const delay = Math.min(WS_RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts), WS_RECONNECT_MAX_DELAY);
  setTimeout(() => connect(), delay);
  reconnectAttempts++;
}

// 启动
connect();
```

```typescript
// extension/src/cdp.ts - attach 容错
export async function ensureAttached(tabId: number, aggressiveRetry = false) {
  if (attached.has(tabId)) {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: '1', returnByValue: true,
      });
      return; // 仍然 attached
    } catch {
      attached.delete(tabId);
    }
  }
  const MAX_ATTACH_RETRIES = aggressiveRetry ? 5 : 2;
  for (let attempt = 1; attempt <= MAX_ATTACH_RETRIES; attempt++) {
    try {
      try { await chrome.debugger.detach({ tabId }); } catch {}
      await chrome.debugger.attach({ tabId }, '1.3');
      attached.add(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      return;
    } catch (e) {
      if (attempt < MAX_ATTACH_RETRIES) {
        await new Promise(r => setTimeout(r, aggressiveRetry ? 1500 : 500));
      }
    }
  }
  throw new Error('attach failed');
}
```

```typescript
// extension/src/stealth.ts - 完整抄 opencli (95 行)
// 见 /Users/dolphin/Desktop/Dolphin/opencli/src/browser/stealth.ts 的 generateStealthJs
// 主要 6 件事：webdriver/chrome/plugins/languages/Permissions/cdc_*
```

**stealth 注入时机（最关键）**：
```typescript
// 在拿到 CDP attach 之后、用户脚本执行之前，立刻注入 stealth
async function ensureStealthInjected(tabId: number) {
  await ensureAttached(tabId, true);
  await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
  await chrome.debugger.sendCommand({ tabId }, 'Page.addScriptToEvaluateOnNewDocument', {
    source: generateStealthJs(),
  });
}
```

### Phase 2：网络抓 body（拿到完整 key）

**目标**：用 `Network.enable` + `Network.getResponseBody` 抓平台 API 响应里的真实 key。

**修改文件**：
- `extension/src/cdp.ts`：加 `Network.enable` + 监听 `Network.responseReceived` + `Network.getResponseBody`
- `extension/src/protocol.ts`：action 增加 `network-capture-start`、`network-capture-read`
- `extension/src/background.ts`：实现两个新 action 的 handler

**Phase 2 验收标准**：
1. 扩展能捕获 zhipu 创建 key 后的 API 响应 body
2. body 里包含完整的 key（在 `data.apiKey` 或 `data.secret_key` 等字段里）
3. OKIT 收到的 key 跟 zhipu 后台显示的一致（长度、格式）

**Phase 2 关键代码**：

```typescript
// extension/src/cdp.ts - 监听 Network
chrome.debugger.onEvent.addListener((source, method, params: any) => {
  if (method === 'Network.responseReceived') {
    const response = params.response;
    if (response.url.includes('zhipu') || response.url.includes('getapikey')) {
      // 用 requestId 抓 body
      chrome.debugger.sendCommand(
        { tabId: source.tabId },
        'Network.getResponseBody',
        { requestId: params.requestId }
      ).then(body => {
        // 解析 JSON 找到 key 字段
        const data = JSON.parse(body.body);
        if (data.data?.apiKey) capturedKey = data.data.apiKey;
      }).catch(() => {});
    }
  }
});
```

### Phase 3：多平台适配 + 优化

**目标**：把 zhipu 选择器抽出来变成 platform registry，支持 10+ 平台。

**修改文件**：
- `extension/src/platforms.ts`：平台注册表，每个平台有 url/selectors/createFlow/keyField
- `extension/src/background.ts`：根据 platform 选流程

**支持的平台**（按优先级）：
1. **zhipu**（智谱 AI）- URL: `https://open.bigmodel.cn/apikey/platform`
2. **volcengine**（火山引擎）- URL: `https://console.volcengine.com/iam/keymanage/`
3. **minimax**（MiniMax）- URL: `https://platform.minimaxi.com/user-center/basic-information/interface-key`
4. **openai** - URL: `https://platform.openai.com/api-keys`
5. **anthropic** - URL: `https://console.anthropic.com/settings/keys`
6. **google**（AI Studio）- URL: `https://aistudio.google.com/apikey`
7. **huggingface** - URL: `https://huggingface.co/settings/tokens`
8. **openrouter** - URL: `https://openrouter.ai/settings/keys`

**每个平台的 PlatformConfig**：
```typescript
interface PlatformConfig {
  name: string;            // 中文显示名
  url: string;             // 后台 API key 创建页
  createButton: string;    // 「创建」按钮文本选择器（部分文字）
  nameInput: string;       // key 名称输入框
  confirmButton: string;   // 确认/创建 按钮
  keyExtractFn: (apiResponse: any) => string | null;  // 从 API 响应提取 key
  networkPatterns: string[];  // 监听的 API URL pattern
}
```

**Phase 3 验收标准**：
1. 同样的扩展能跑通 8 个平台里的至少 5 个（zhipu/volcengine/minimax 必通）
2. 每个平台的工作流都用 platform config 表达，不再 hardcode

### Phase 4：桌面版 daemon 常驻 + 端到端测试

**目标**：把 OKIT server 集成进 Electron 桌面版启动流程，常驻运行。

**修改文件**：
- `package.json`：加 `scripts.daemon: "node scripts/daemon.js"`
- `scripts/daemon.js`：常驻进程入口
- `src/electron/main.ts`（如果有）：启动 Electron 时 `child_process.spawn` 拉起 daemon
- `src/web/server.js`：保留为开发模式入口，daemon.js 内部直接 import 它
- `src/web/api/ws-extension.js`：连接 daemon 时探测

**daemon 设计**：
```javascript
// scripts/daemon.js
const fs = require('fs');
const path = require('path');
const os = require('os');

// PID 文件 + 日志
const PID_FILE = path.join(os.homedir(), '.okit', 'daemon.pid');
const LOG_FILE = path.join(os.homedir(), '.okit', 'daemon.log');

// 启动 server
const { startServer } = require('../dist/web/server.js');
startServer(3780);

// 写 PID 文件
fs.writeFileSync(PID_FILE, String(process.pid));
process.on('exit', () => fs.unlinkSync(PID_FILE));
```

**OKIT 桌面版拉起 daemon（macOS 示例）**：
```typescript
// src/electron/main.ts
import { spawn } from 'child_process';
import { app } from 'electron';

app.whenReady().then(() => {
  // 拉起 daemon
  const daemon = spawn('node', [path.join(__dirname, '../../scripts/daemon.js')], {
    detached: true,
    stdio: 'ignore',
  });
  daemon.unref();
});
```

**Phase 4 验收标准**：
1. `npm run daemon` 启动后 `curl http://127.0.0.1:3780/api/vault/cdp-status` 返回 200
2. `lsof -i :3780` 显示监听中
3. 关闭终端窗口后 daemon 仍在跑
4. 桌面版（Electron）启动后自动 daemon 起来
5. **端到端**：用户从「⚡ 自动创建密钥」按钮触发 → 弹 Chrome 窗口 → 自动完成 → 拿回 key 全流程跑通
6. 至少 zhipu / volcengine / minimax 三个平台都通过端到端测试

---

## 6. 验证矩阵（每个阶段都要跑）

| Phase | 关键验证 | 工具 |
|-------|----------|------|
| 1 | 扩展能连 OKIT，控制台打印 `[OKIT] Connected to daemon` | Chrome 扩展 service worker 控制台 |
| 1 | zhipu 走完整流程拿到真 key（key 长度 > 100） | `curl -X POST /api/vault/auto-create -d '{"platform":"zhipu"...}'` |
| 2 | Network.getResponseBody 能拿到 JSON body | Chrome Network 面板 + service worker 日志 |
| 3 | 至少 5/8 平台自动创建成功 | 逐平台 curl 测试 |
| 4 | daemon `npm run daemon` 后 3780 长占 | `lsof -i :3780` 持续 1 分钟 |
| 4 | Electron 启动后 daemon 自动起 | 关闭 Electron 重开，检查 PID 文件 |

---

## 7. 踩坑清单（必看）

### 坑 1：Chrome Service Worker 强缓存
- 改 `background.js` 后点 🔄 刷新不重载文件，必须升 `manifest.json` 的 `version` 字段
- 建议每次提交都升 patch 版本号：`2.0.0` → `2.0.1` → `2.0.2` ...

### 坑 2：`chrome.scripting` 升级权限后必须重装扩展
如果 `manifest.json` 的 `permissions` 改了，光点 🔄 不够——必须「移除 → 重新加载已解压的扩展」。

### 坑 3：stealth 注入时机
- ❌ 在 `Runtime.evaluate` 之后注入 stealth（太晚了）
- ✅ 在 `Page.addScriptToEvaluateOnNewDocument` 里注入（页面加载前）

### 坑 4：attach 失败
`chrome.debugger.attach` 失败常见原因：
- URL 是 `chrome://` / `chrome-extension://` / DevTools 自身
- 其他扩展（如 1Password）占着 debugger

**对策**：
```typescript
function isDebuggableUrl(url?: string) {
  if (!url) return true;
  return url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank';
}
```
+ 重试时先 `chrome.debugger.detach` 强清。

### 坑 5：CSP
- `chrome.scripting.executeScript` 注入受**目标网站**的 CSP 限制
- 必须用 `awaitPromise: true`，且函数以纯 JS 函数形式注入
- **不要**用 `Function('return ...')` 或 `eval()`（会撞 CSP）

### 坑 6：anti-detection 第 6 维容易漏
```javascript
for (const prop of Object.getOwnPropertyNames(window)) {
  if (prop.startsWith('cdc_') || prop.startsWith('__cdc_')) {
    try { delete window[prop]; } catch {}
  }
}
```
这是清理 ChromeDriver / Selenium 残留，**必须做**。

### 坑 7：key 提取可能被噪音干扰
zhipu 创建后的页面里有：
- base64 图片（`iVBORw...`）
- SVG path data（`M117.5...`）
- 字体文件（`AAEAAAA...`）

策略：
1. **优先用 Network.getResponseBody 拿 API 响应里的 key**（最稳）
2. fallback 才用 DOM 提取（带过滤）

### 坑 8：沙箱环境
- OKIT server 在沙箱里会被自动杀（agent 回合结束时）
- **开发模式**：手动 `nohup ... & disown` 启动
- **桌面版**：用 Electron child_process 拉起，常驻

### 坑 9：分阶段交付，不要一次写完
- 每阶段先验证再进下阶段
- 不要 4 个阶段同时写

---

## 8. 文件结构（最终）

```
okit/
├── extension/                          <-- Chrome 扩展
│   ├── manifest.json                   <-- MV3, permissions, version
│   ├── tsconfig.json                   <-- TS 编译配置
│   ├── package.json                    <-- devDeps: typescript, @types/chrome
│   ├── src/
│   │   ├── protocol.ts                 <-- 命令/响应协议
│   │   ├── cdp.ts                      <-- CDP attach 容错 + network 抓包
│   │   ├── background.ts               <-- WS 客户端 + keepalive + 命令派发
│   │   ├── stealth.ts                  <-- generateStealthJs (6 维 anti-detection)
│   │   └── platforms.ts                <-- 10+ 平台注册表 (Phase 3)
│   ├── dist/
│   │   └── background.js               <-- tsc 编译产物
│   └── icons/
│       └── icon{16,48,128}.png
│
├── src/
│   ├── web/
│   │   ├── api/
│   │   │   ├── ws-extension.js         <-- OKIT server 的 WS 端点
│   │   │   └── auto-create.js          <-- 走扩展通道（不再 spawn Playwright）
│   │   └── server.js                   <-- OKIT web server（开发模式入口）
│   ├── scripts/
│   │   └── auto-create-key.mjs         <-- 保留，作为 backend 备选
│   └── electron/
│       └── main.ts                     <-- 桌面版入口，启动时拉 daemon
│
├── scripts/
│   └── daemon.js                       <-- 新增 OKIT daemon 入口（nohup 单进程）
│
├── docs/
│   └── AUTO-CREATE-EXTENSION-PLAN.md   <-- 本文档
│
└── package.json                        <-- 加 scripts.daemon
```

---

## 9. 参考资料

### 9.1 opencli 关键源文件位置

| 文件 | 路径 | 行数 |
|------|------|------|
| 协议 | `/Users/dolphin/Desktop/Dolphin/opencli/extension/src/protocol.ts` | 87 |
| CDP | `/Users/dolphin/Desktop/Dolphin/opencli/extension/src/cdp.ts` | 440 |
| Background | `/Users/dolphin/Desktop/Dolphin/opencli/extension/src/background.ts` | 878 |
| Stealth | `/Users/dolphin/Desktop/Dolphin/opencli/src/browser/stealth.ts` | 354 |
| Stealth 注入 | `/Users/dolphin/Desktop/Dolphin/opencli/src/browser/cdp.ts:75` | (line 75) |

### 9.2 我们当前状态

- Playwright 实现：`/Users/dolphin/Desktop/Dolphin/okit/src/scripts/auto-create-key.mjs`
- 扩展 v1（旧）：`/Users/dolphin/Desktop/Dolphin/okit/extension/`
- 扩展 WS 服务：`/Users/dolphin/Desktop/Dolphin/okit/src/web/api/ws-extension.js`
- 旧 memory：`/Users/dolphin/Desktop/Dolphin/okit/.workbuddy/memory/2026-08-08.md`

### 9.3 opencli README（强调点）

> CLI tool that turns any website, Electron app, or local CLI tool into a command-line interface. **Account-safe** — Reuses Chrome/Chromium logged-in state; your credentials never leave the browser. **Anti-detection built-in** — Patches navigator.webdriver, stubs window.chrome, fakes plugin lists.

---

## 10. 实施者须知

1. **不要一次写 4 个阶段**——每阶段先验证再进下阶段
2. **TypeScript 重写 700 行 JS**——会花 2-3 小时，慢慢来
3. **每阶段都要在真实 Chrome 里手测一次**——Service Worker 缓存顽固，别只信代码
4. **如果卡住超过 1 小时**：停下来回顾——是不是撞到本文档列的某个坑
5. **最终验收**：用户在桌面端触发「⚡ 自动创建密钥」，能跑通 zhipu/volcengine/minimax 至少一个平台，拿到完整 key

---

**文档版本**：v1.0（2026-08-08）
**作者**：基于 opencli 调研 + 用户访谈
**下一步**：交付给实施者，按 Phase 1 开始
