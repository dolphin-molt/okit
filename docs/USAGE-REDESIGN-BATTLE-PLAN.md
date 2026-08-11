# OKIT 用量统计与快速启动改造 · 实战文档

> **分支**: `feat/usage-and-quickstart-redesign`
> **日期**: 2026-08-11
> **对标**: cc-switch v3.10.3（Tauri + React）
> **原则**: cc-switch 已实践过的直接照抄，不重新发明

---

## 目录

- [目标①：用量统计对接 + 订阅/充值二分类](#目标-用量统计对接--订阅充值二分类)
- [目标②：快速启动页驾驶舱化](#目标-快速启动页驾驶舱化)
- [目标③：常用模型机制](#目标-常用模型机制)
- [目标④：Agent 切换模型统一实测](#目标-agent-切换模型统一实测)
- [跨目标章节：实施顺序、风险、验收](#跨目标章节)

---

## 目标①：用量统计对接 + 订阅/充值二分类

### 1.1 现状问题（必须先理解）

**文件清单**：
- 后端：`src/web/api/usage.js`（540 行）
- 前端：`src/web/frontend/src/components/usage/UsagePage.tsx`（304 行）
- 样式：`src/web/frontend/src/styles/usage.css`（225 行）
- 路由：`src/web/server.js:117-119`

**覆盖现状（39 个预设，仅 7 个有实时数据）**：

| 状态 | 数量 | 具体 Provider |
|---|---|---|
| ✅ 实时查询 | 7 | `glm-coding`、`kimi-coding-plan`、`minimax-coding`、`openrouter`、`openai-codex`、`anthropic-agent`、`volcengine-coding` |
| ⚠️ 仅控制台提示 | 3 | `google-agent`、`github-copilot`、`xai-grok-build` |
| ❌ 完全不支持 | 29 | `anthropic`(API)、`openai`(API)、`google`(API)、`deepseek`、`siliconflow`、`moonshot`、`qwen`、`qianfan`、`qianfan-coding`、`tencent-tokenhub`、`tencent-coding`、`mistral`、`stepfun`、`xiaomi`、`xai`、`zai`、`minimax` 等 |

**订阅 vs 充值的现状（散落两处，无统一枚举）**：
- 前端 `UsagePage.tsx:7-18` 的 `PROVIDER_META[id].type` 字符串：`'Agent 订阅' | 'Coding Plan' | 'Token Plan' | '充值制'`
- 后端 `usage.js:328` 的 `isPrepaid` flag（仅 OpenRouter 为 true）
- **UI 无分组**，所有 Provider 平铺一个网格

### 1.2 cc-switch 怎么做的（直接照抄的点）

cc-switch 有**两套独立系统**，OKIT 本次只做其中一套（脚本查余额），代理拦截方案工程量太大暂不做。

**照抄点 1：统一的 `UsageData` schema（支持多套餐）**

cc-switch 的 `src/types/usage.ts:72-89` 定义：
```typescript
interface UsagePlan {
  planName: string;       // "5小时窗口" / "周套餐" / "API 余额"
  total: number | null;   // 总量（百分比场景=100，余额场景=美元总额）
  used: number | null;    // 已用
  remaining: number | null; // 剩余
  unit: string;           // "%" / "USD" / "req" / "times"
  isValid: boolean;       // false=套餐过期/失效
  invalidMessage?: string;
  resetAt?: string;       // ISO 时间，充值制无此字段
  extra?: string;         // 自由文本（如套餐组名）
}
```

**照抄点 2：General / NewAPI 两个通用模板**

cc-switch 发现大量国内中转站（NewAPI 系）遵循统一接口，两个模板覆盖 80% 场景：

| 模板 | 请求 | 提取 |
|---|---|---|
| General | `GET {{baseUrl}}/user/balance` + `Authorization: Bearer {{apiKey}}` | `response.balance` = 剩余 USD |
| NewAPI | `GET {{baseUrl}}/api/user/self` + `New-Api-User: {{userId}}` header | `quota/500000` = USD，含 `used_quota`、`group` |

### 1.3 改造方案

#### 第 1 步：统一数据模型（后端）

**文件**：`src/web/api/usage.js`

在文件顶部新增 `UsageKind` 枚举和统一 schema：

```javascript
// 新增：用量类型枚举（取代散落的 type 字符串 + isPrepaid）
const UsageKind = {
  SUBSCRIPTION: 'subscription',  // 订阅/套餐：百分比 + 重置时间
  PREPAID: 'prepaid',            // 充值/API 余额：绝对金额，无重置
};

// 统一响应 shape（向后兼容现有 windows 字段）
// {
//   providerId, supported: true, kind: 'subscription' | 'prepaid',
//   plans: [{ planName, usedPercent, resetAt }]  // subscription
//          | { balance, used, total, currency }   // prepaid
//   windows: [...]  // 保留旧字段，= plans 的别名，避免前端炸
//   raw
// }
```

为每个 `SUPPORTED` 的 provider 增加 `kind` 元数据。改造现有 7 个查询函数返回 `kind`。

#### 第 2 步：补齐主流 Provider（后端）

按下表逐个实现，每个新增一个 `queryXxxUsage(provider, apiKey)` 函数并加入 `SUPPORTED` 和 dispatcher：

| Provider ID | 类型 | API | 提取逻辑 | 难度 |
|---|---|---|---|---|
| `deepseek` | prepaid | `GET https://api.deepseek.com/user/balance` + `Bearer` | `balance_info.total_balance` / `granted_balance` | 🟢 简单 |
| `siliconflow` | prepaid | `GET https://api.siliconflow.cn/v1/user/info` + `Bearer` | `data.balance` | 🟢 简单 |
| `moonshot` | prepaid | `GET https://api.moonshot.cn/v1/users/me/balance` + `Bearer` | `data.available_balance` | 🟢 简单 |
| `qwen` | prepaid | `GET https://dashscope.aliyuncs.com/compatible-mode/v1/usage` + `Bearer` | `data.balance` | 🟡 需实测 |
| `openai` | prepaid | `GET https://api.openai.com/v1/organization/costs?start_time=...&end_time=...` | 聚合 `data.results[].total_cost` | 🟡 需日期窗口 |
| `anthropic` | prepaid | 无公开余额 API | 返回 `supported:false` + 控制台提示 | ⚠️ 无法对接 |
| `mistral` | prepaid | `GET https://api.mistral.ai/v1/credits` + `Bearer` | `data[0].balance` | 🟢 简单 |
| `tencent-tokenhub` | prepaid | 需 Tencent Cloud SigV4 | 复用 volcengine 的 SigV4 实现 | 🔴 复杂 |
| `qianfan` | prepaid | `GET https://qianfan.baidubce.com/v2/user/balance` | 需百度 AK/SK | 🔴 复杂 |

**实现顺序**：先做 🟢 的 5 个（DeepSeek/硅基/Moonshot/Mistral/Qwen），覆盖最常见的国内充值制；🟡 的 OpenAI 次之；🔴 的腾讯/百度最后（且可能只能返回控制台提示）。

**每个新函数的模板**（以 DeepSeek 为例）：
```javascript
async function queryDeepseekUsage(provider, apiKey) {
  const res = await fetch('https://api.deepseek.com/user/balance', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const data = await res.json();
  // DeepSeek 返回 { is_available: true, balance_info: { total_balance, granted_balance, topped_up_balance } }
  const total = round4(data.balance_info?.total_balance ?? 0);
  const granted = round4(data.balance_info?.granted_balance ?? 0);
  return {
    providerId: 'deepseek',
    supported: true,
    kind: UsageKind.PREPAID,
    plans: [{
      planName: 'API 余额',
      total: total,
      used: round4(total - granted), // 已用 = 总额 - 剩余赠送额（近似）
      remaining: total,
      unit: 'USD',
      isValid: data.is_available !== false,
    }],
    raw: data,
  };
}
```

#### 第 3 步：前端订阅/充值 tab 切换

**文件**：`src/web/frontend/src/components/usage/UsagePage.tsx`

新增 `usageMode` state：`'subscription' | 'prepaid'`。在 hero bar 下方加一个二选一切换器（复用 `models` 页的 `view-switcher` 样式）：

```tsx
const [usageMode, setUsageMode] = useState<'subscription' | 'prepaid'>('subscription');

// 按 kind 分组
const subscriptionCards = sortedCards.filter(c => c.result?.kind === 'subscription');
const prepaidCards = sortedCards.filter(c => c.result?.kind === 'prepaid');

// 渲染时根据 usageMode 切换显示哪组
```

卡片样式差异：
- **订阅卡**：保持现有 `UsageBar`（百分比条 + 重置时间 tooltip）
- **充值卡**：显示 `余额 $X.XX` + `已用 $Y.YY` + 一个进度条（已用/总额），颜色按剩余比例

#### 第 4 步：i18n 补全

**文件**：`src/web/frontend/src/i18n/zh.ts` 和 `en.ts` 的 `usage.*` 命名空间

新增 key：
```
usage.tabSubscription = '订阅套餐' / 'Subscription'
usage.tabPrepaid = '充值余额' / 'Prepaid Balance'
usage.balance = '余额' / 'Balance'
usage.usedAmount = '已用' / 'Used'
usage.noData = '暂不支持查询，请前往控制台' / 'Not supported, visit console'
```

### 1.4 验收标准

- [ ] 新增至少 5 个 prepaid provider 的实时查询（DeepSeek/硅基/Moonshot/Mistral/Qwen）
- [ ] `GET /api/usage/:providerId` 返回包含 `kind` 字段
- [ ] 前端用量页有"订阅 / 充值"二选一切换器
- [ ] 订阅卡显示百分比条，充值卡显示美元余额
- [ ] 原 7 个 provider 的查询不回归

---

## 目标②：快速启动页驾驶舱化

### 2.1 现状问题

**文件**：`src/web/frontend/src/components/home/HomePage.tsx`（170 行）

当前内容只有三块：
1. Agent 图标 tab 行（9 个 Agent）
2. Agent 头像 + 启动按钮
3. 该 Agent 兼容的 Provider 卡片（展开选模型）

**问题**：
- 用户每天进来只看到"选 Agent + 选模型"，看不到任何用量信息
- 选模型时弹出该 Provider 下**全部模型**（OpenAI 下 5 个、ZAI 下十几个），用户实际只用 2-3 个
- 有 400+ 行孤儿 CSS（`home-hero`、`home-stat-grid`、`qs-card` 等）和 60 个孤儿 i18n key 未清理
- 用量在独立的 `/usage` 页，首页看不到

### 2.2 改造方向（对标 cc-switch + 你的诉求）

cc-switch 首页是纯 Provider 列表 + 每张卡内联用量。你的诉求更进一步：**首页 = 每日驾驶舱**，聚合"常用模型 + 常用 Provider 用量 + 常用工具"。

**新首页结构**（自上而下）：

```
┌─────────────────────────────────────────────────┐
│ 快速启动                              [全部刷新] │
├─────────────────────────────────────────────────┤
│ 📊 今日用量摘要                                  │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│ │ Claude   │ │ GLM      │ │ DeepSeek │  ...    │
│ │ 72% 5h窗 │ │ 45% 本周 │ │ $12.34   │         │
│ └──────────┘ └──────────┘ └──────────┘         │
├─────────────────────────────────────────────────┤
│ ⭐ 常用模型（最多 6 个，可编辑）                  │
│ [Claude Opus 4.7] [GLM-4.7] [DeepSeek V4] ...  │
│ 点一个 → 展开选择要切到哪个 Agent                │
├─────────────────────────────────────────────────┤
│ 🛠️ 常用工具                                      │
│ [Claude Code ▶] [Codex ▶] [Gemini ▶]            │
└─────────────────────────────────────────────────┘
```

### 2.3 实施步骤

#### 第 1 步：新增"今日用量摘要"区块

**新组件**：`src/web/frontend/src/components/home/UsageSummary.tsx`

- 复用 `getUsage()` API（目标①改完后带 `kind`）
- 只显示用户**标记为常用**的 Provider（见目标③）的用量
- 没有"常用"标记时，显示所有 supported 的 Provider（最多 6 个）
- 每张迷你卡：Provider 名 + 一个核心数字（订阅显示最高窗口百分比，充值显示余额）
- 颜色：≥90% 红、≥70% 橙、否则绿

#### 第 2 步：新增"常用模型"区块

**新组件**：`src/web/frontend/src/components/home/FavoriteModels.tsx`

- 数据源：目标③实现的"常用模型"持久化
- 渲染为 chip 网格，每个 chip 显示模型名 + 所属 Provider 小图标
- 点击 chip → 弹出小 popover 选择切到哪个 Agent（Claude/Codex/...）
- 选中后调用 `switchProvider(agentId, providerId, modelId)`（目标④统一后的入口）
- 支持"编辑"模式：添加/移除常用模型，拖拽排序

#### 第 3 步：改造现有 Agent tab + Provider 卡片区

保留现有 Agent tab + 启动按钮，但改造 Provider 卡片：
- **默认只显示常用模型**（从全量列表里过滤出 favorite/recent）
- 增加"显示全部"折叠按钮，才展开全量模型
- 这样用户日常看到的就是 2-3 个，不是几十个

#### 第 4 步：新增"常用工具"区块

**新组件**：`src/web/frontend/src/components/home/QuickTools.tsx`

- 数据源：`getAdapters()`（现有 API）+ 用户的"常用工具"标记
- 每个工具一个大按钮：图标 + 名字 + 启动图标
- 点击直接 `launchAgent(agent)`
- 显示该工具当前用的模型（从 `agent.current` 读）

#### 第 5 步：清理孤儿代码

删除 `src/web/frontend/src/styles/home.css` 中未被引用的类：
- `.home-hero` / `.home-kicker` / `.home-lede` / `.home-pill`
- `.home-stat-grid` / `.home-stat-card`
- `.home-check-list` / `.home-actions` / `.home-log-list`
- `.qs-card` / `.qs-stat` / `.qs-agent-grid` 等全部 qs-* 前缀

删除 `src/web/frontend/src/styles/quick-start.css`（134 行，完全孤儿）。

清理 `i18n/zh.ts` 和 `en.ts` 中约 60 个未被引用的 `home.*` key（先用 grep 确认无引用再删）。

### 2.4 验收标准

- [ ] 首页顶部有"今日用量摘要"，显示常用 Provider 的用量
- [ ] 首页有"常用模型"区块，显示 ≤6 个常用模型 chip
- [ ] Agent tab 下的 Provider 卡片默认只显示常用模型
- [ ] 首页有"常用工具"快速启动区块
- [ ] 孤儿 CSS/i18n 清理完毕，`npm run build` 无 warning

---

## 目标③：常用模型机制

### 3.1 现状问题

- **完全没有** favorite/pinned/recent 概念
- `ModelPickerModal`（90 行）已导出但**零引用**，死代码
- `localStorage['okit.managedModels']` 有写入（ModelsPage 批量启用）但**无读取**，死代码
- 选择器（AgentPage popover + HomePage Provider 卡）每次都显示全量模型

### 3.2 cc-switch 怎么做的

cc-switch **也没有**常用模型机制（它的模型是 per-provider 自由文本，没有全局目录）。这是 OKIT 可以**超越** cc-switch 的点。

但 cc-switch 有两个相关设计值得借鉴：
1. **Provider 的 `sortIndex` 字段**：用户拖拽排序，持久化到 DB。OKIT 可给模型加 `sortOrder`。
2. **`is_current` 状态**：切换时自动记录。OKIT 可基于此推导"最近使用"。

### 3.3 改造方案

#### 数据模型

**文件**：`~/.okit/user.json` 新增 `favoriteModels` 和 `recentModels` 字段：

```json
{
  "config": {
    "providers": { ... },
    "favoriteModels": [
      { "providerId": "anthropic", "modelId": "claude-opus-4-7", "addedAt": "2026-08-11T..." }
    ],
    "recentModels": [
      { "providerId": "glm-coding", "modelId": "glm-4.7", "lastUsedAt": "2026-08-11T...", "agentId": "claude" }
    ]
  }
}
```

- `favoriteModels`：用户显式收藏，上限 20 个
- `recentModels`：每次 `switchProvider` 成功后自动追加/置顶，上限 10 个，按 `lastUsedAt` 排序

#### 后端 API

**文件**：`src/web/api/providers.js`

新增 3 个端点：

```
POST   /api/providers/models/favorite     body: { providerId, modelId }   → 加入收藏
DELETE /api/providers/models/favorite/:providerId/:modelId                → 取消收藏
GET    /api/providers/models/favorites                                     → 返回收藏+最近列表
```

在现有 `switchProvider`（`providers.js:417-457`）成功后，**自动追加到 recentModels**：

```javascript
// switchProvider 成功后追加（providers.js:442 之后）
if (!config.recentModels) config.recentModels = [];
config.recentModels = [
  { providerId, modelId, agentId, lastUsedAt: new Date().toISOString() },
  ...config.recentModels.filter(m => !(m.providerId === providerId && m.modelId === modelId)),
].slice(0, 10);
```

#### 前端 UI

**模型选择器改造**（AgentPage popover + HomePage 卡片 + 目标②的 FavoriteModels）：

所有显示模型列表的地方，统一渲染规则：
1. **置顶区**：favoriteModels ∩ 当前 Provider 的模型（带 ⭐ 标记）
2. **最近区**：recentModels ∩ 当前 Provider 的模型（带时钟图标）
3. **全部区**：其余模型（折叠，点击"显示全部"展开）

**收藏入口**：每个模型 chip 旁加一个 ⭐ 按钮（hover 显示），点击 toggle 收藏。

**Models 页集成**：`ModelsPage.tsx` 的 PlatformDetailPanel 模型列表，每行加 ⭐ 按钮。

#### 新组件

**文件**：`src/web/frontend/src/components/shared/FavoriteButton.tsx`
- 受控组件，props: `{ providerId, modelId, size? }`
- 内部调 `POST/DELETE /api/providers/models/favorite`
- 显示实心/空心星

### 3.4 验收标准

- [ ] `user.json` 持久化 `favoriteModels` 和 `recentModels`
- [ ] switchProvider 成功后自动更新 recentModels
- [ ] 模型选择器（AgentPage/HomePage）置顶显示收藏+最近
- [ ] Models 页每个模型可 ⭐ 收藏
- [ ] 首页"常用模型"区块正确渲染收藏列表

---

## 目标④：Agent 切换模型统一实测

> **这是最关键的目标**。当前 OKIT 的切换有多处 bug 和不一致，必须先修好才能让目标②③的 UI 真正可用。

### 4.1 现状问题（严重）

#### 问题 A：双套实现已漂移

OKIT 有**两套并行的切换逻辑**，已经分叉：

| 路径 | 代码 | 用于 | 状态 |
|---|---|---|---|
| TS adapters | `src/providers/adapters/*.ts` + `registry.ts` | CLI（`okit provider use`） | 较新，codex/claude 有测试 |
| JS writers | `src/web/api/providers.js` 的 `applyAgentConfig` | Web UI（`POST /api/providers/switch`） | 较旧，**零测试** |

**已知漂移**：
- **Codex**：TS 版删除遗留的 `api_base` 键、按 `protocol` 选 `wire_api`（`codex.ts:44,48`）；JS 版不删 `api_base`、硬编码 `wire_api="responses"`（`providers.js:552-553`）。**Web 切换会导致 Codex 配置损坏**。
- **OpenClaw**：JS 版 `applyOpenClawConfig` 原样复制 `provider.models`（`providers.js:670`）；TS 版映射为 `{id,name,capabilities}`。不一致。

#### 问题 B：Gemini 完全丢弃 model

`applyGeminiConfig(apiKey)`（`providers.js:642-648`）签名只收 `apiKey`，**model 参数被丢弃**（`providers.js:470` 调用时没传 model）。切换 Gemini 后只写了 API key，模型没变。

#### 问题 C：HomePage 与聊天页状态不互通

| | HomePage | AgentPage 聊天页 |
|---|---|---|
| 端点 | `POST /api/providers/switch` | `POST /api/settings` |
| 写 agent 配置文件？ | ✅ 是 | ❌ **否**，只写 `user.json.config.agent` |
| 更新 `user.json.providers`？ | ✅ 是 | ❌ 否 |
| 验证兼容性？ | ✅ 是 | ❌ 否 |

**后果**：在 HomePage 切了 Claude 的模型，聊天页的 composer 不反映；反之亦然。

#### 问题 D：零测试覆盖

- JS `applyAgentConfig` 的 9 个 writer：**0 测试**
- `switchProvider` HTTP handler：**0 测试**
- 9 个 TS adapter：仅 `claude` 和 `codex` 有测试，其余 7 个（gemini/opencode/openclaw/workbuddy/zcode/hermes/kimi-code）无测试

### 4.2 cc-switch 怎么做的（照抄）

#### 照抄点 1：单一写入入口

cc-switch 所有切换走 `write_live_snapshot()`（`src-tauri/src/services/provider/live.rs:108`），按 app 分发。**没有 TS/JS 双套**。

#### 照抄点 2：原子写

`atomic_write()`（`config.rs:184-239`）：写 `{filename}.tmp.{nanos_timestamp}` 再 rename。Unix 保留原文件 mode。**避免半写损坏**。

#### 照抄点 3：切换前 backfill

`switch_normal()`（`mod.rs:450-503`）切换前**读当前 live 文件回写到旧 provider 记录**。这样用户手改的 `settings.json` 不会丢。

#### 照抄点 4：各 Agent 的精确配置格式

**Claude Code** → `~/.claude/settings.json`：
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_MODEL": "DeepSeek-V3.2",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "DeepSeek-V3.2",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "DeepSeek-V3.2",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "DeepSeek-V3.2"
  }
}
```
切回官方：写 `{"env":{}}` 清空。

**Codex** → `~/.codex/auth.json` + `~/.codex/config.toml`：
```json
// auth.json
{ "OPENAI_API_KEY": "sk-xxx" }
```
```toml
# config.toml
model = "gpt-5.5"
model_provider = "okit-custom-openai"

[model_providers.okit-custom-openai]
name = "Custom OpenAI"
base_url = "https://custom.api.com/v1"
env_key = "OKIT_CODEX_CUSTOM_OPENAI_API_KEY"
wire_api = "responses"
requires_openai_auth = true
```

**Gemini** → `~/.gemini/.env` + `~/.gemini/settings.json`（合并）：
```
# .env
GEMINI_API_KEY=sk-xxx
GEMINI_MODEL=gemini-3-pro
GOOGLE_GEMINI_BASE_URL=https://www.packyapi.com
```
```json
// settings.json（只合并 security.auth.selectedType，保留其他字段）
{ "security": { "auth": { "selectedType": "gemini-api-key" } } }
```
OAuth 场景：清空 .env + 设 `selectedType: "oauth-personal"`。**不写 `GOOGLE_GENAI_USE_VERTEXAI`**。

**OpenCode / OpenClaw** → additive 模式（读-改-写，只插入一个 provider key，不替换）。

#### 照抄点 5：current 状态双存储

cc-switch 用 device-level `~/.cc-switch/settings.json`（`currentProviderClaude` 等字段，不云同步）+ DB `is_current`（云同步默认值）。OKIT 对应 `user.json.config.providers[agentId]`（已存在），无需改架构。

### 4.3 改造方案

#### 第 1 步：消除双套实现（统一到 TS adapter）

**核心决策**：让 Web API 也走 TS adapter，废弃 `providers.js` 里的 `applyAgentConfig` 及 9 个 JS writer。

**文件改动**：

1. `src/web/api/providers.js` 的 `switchProvider`：
   - 删除 `applyAgentConfig` 调用（`providers.js:438`）
   - 改为调用经编译的 TS adapter：`require('../../dist/providers/registry').getAdapter(agentId).applyConfig(provider, modelId)`

2. `src/web/server.js` 启动时确保 `dist/providers/` 已编译（`npm run build` 含 tsc）。

3. 删除 `providers.js` 中的 `applyAgentConfig`、`applyClaudeConfig`、`applyCodexConfig`、`applyGeminiConfig`、`applyOpenClawConfig`、`applyJsonAgentConfig`、`applyWorkBuddyConfig`、`applyKimiCodeConfig`、`applyOpenCodeConfig`（约 300 行死代码）。

#### 第 2 步：修复 TS adapter 的已知 bug

按 cc-switch 的实现校准每个 adapter：

**`src/providers/adapters/codex.ts`**（参考 cc-switch `codex_config.rs`）：
- 确认删除 `api_base`（已有）
- 确认按 `protocol` 选 `wire_api`（已有）
- **新增**：auth.json 与 config.toml 分离写入（当前 OKIT 只写 config.toml + .env，cc-switch 写 auth.json）

**`src/providers/adapters/gemini.ts`**（参考 cc-switch `gemini_config.rs`）：
- **修复**：当前只写 API key，必须同时写 `GEMINI_MODEL`
- **新增**：OAuth 场景清空 .env + 写 `settings.json` 的 `security.auth.selectedType`
- **新增**：合并而非覆盖 `settings.json`（保留 mcpServers 等字段）

**`src/providers/adapters/claude.ts`**（参考 cc-switch `live.rs:110-114`）：
- 确认写 3 个 `DEFAULT_*_MODEL`（当前可能只写 `ANTHROPIC_MODEL`）
- **新增**：写前 strip 内部字段（如 OKIT 自定义的 `apiFormat`）

**其余 adapter**（opencode/openclaw/workbuddy/zcode/hermes/kimi-code）：
- 核对与 cc-switch 的差异，主要确认 additive 模式的读-改-写正确

#### 第 3 步：统一 HomePage 和 AgentPage 的切换入口

**文件**：`src/web/frontend/src/components/agent/AgentPage.tsx`

将 `handleComposerModelChange`（`AgentPage.tsx:428-437`）从调 `updateSettings` 改为调 `switchProvider`：

```tsx
// 改前：await updateSettings({ agent: { provider, model } });
// 改后：
await switchProvider('zcode', providerId, modelId); // OKIT 内置聊天用 zcode agent
```

这样聊天页切换也会写 agent 配置文件 + 更新 `user.json.providers`，与 HomePage 一致。

#### 第 4 步：补充测试（最关键）

**新增测试文件**：

1. `tests/providers/adapters/gemini.test.ts` — 覆盖：API key 场景写 `.env` 含 `GEMINI_MODEL`；OAuth 场景清空；`settings.json` 合并不破坏其他字段。

2. `tests/providers/adapters/codex.test.ts` — 补充：验证 `auth.json` 独立写入；`api_base` 删除；`wire_api` 按 protocol 选。

3. `tests/providers/adapters/openclaw.test.ts`、`workbuddy.test.ts`、`zcode.test.ts`、`hermes.test.ts`、`kimi-code.test.ts`、`opencode.test.ts` — 每个 adapter 一个测试文件，覆盖：正确文件路径、正确字段、切回官方的清理、`user.json` 更新。

4. `tests/web/switch-provider.test.js` — **集成测试**：用 supertest 调 `POST /api/providers/switch`，验证 9 个 agent 各自的配置文件被正确写入（mock 文件系统或用 tmpdir）。

**测试模板**（以 gemini 为例）：
```typescript
import { GeminiAdapter } from '../../src/providers/adapters/gemini';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('GeminiAdapter.applyConfig', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'okit-test-')); });

  it('writes GEMINI_MODEL to .env', async () => {
    // 设置 HOME=dir，调 applyConfig，读 dir/.gemini/.env 验证含 GEMINI_MODEL
  });

  it('merges settings.json without destroying mcpServers', async () => {
    // 预写 dir/.gemini/settings.json 含 mcpServers
    // 调 applyConfig，验证 mcpServers 仍在 + security.auth.selectedType 已设
  });
});
```

#### 第 5 步：实测清单（人工）

完成代码改造后，对 9 个 agent 逐一实测：

| Agent | 切到一个第三方 Provider | 验证文件 | 切回官方 | 验证清理 |
|---|---|---|---|---|
| claude | DeepSeek | `~/.claude/settings.json` env 含 BASE_URL/MODEL/AUTH_TOKEN | 官方 Anthropic | env 清空 |
| codex | 自定义 OpenAI | `~/.codex/config.toml` + `auth.json` | OpenAI 官方 | 两文件清空 |
| gemini | PackyCode | `~/.gemini/.env` + `settings.json` | Google OAuth | .env 清空 + selectedType=oauth |
| opencode | DeepSeek | `~/.config/opencode/opencode.json` additive | — | — |
| openclaw | DeepSeek | `~/.openclaw/openclaw.json` additive | — | — |
| workbuddy | GLM | `~/.workbuddy/models.json` | — | — |
| zcode | 火山 | `~/.zcode/config.json` | — | — |
| hermes | GLM | `~/.hermes/config.json` | — | — |
| kimi-code | OpenAI 兼容 | `~/.kimi-code/config.toml` + `.env` | — | — |

### 4.4 验收标准

- [ ] Web API 的 `switchProvider` 走 TS adapter，JS writer 全部删除
- [ ] Gemini 切换正确写入 model（修复 problem B）
- [ ] Codex 切换删除 `api_base`、按 protocol 选 `wire_api`（修复 problem A）
- [ ] HomePage 和 AgentPage 用同一个切换入口（修复 problem C）
- [ ] 9 个 TS adapter 全部有单元测试
- [ ] `switchProvider` 有集成测试
- [ ] 9 个 agent 人工实测通过（上表）

---

## 跨目标章节

### 实施顺序（强烈建议按此顺序）

```
目标④（切换统一）→ 目标③（常用模型）→ 目标①（用量对接）→ 目标②（首页驾驶舱）
```

**理由**：
- 目标④是地基：切换不可靠，UI 再好看也没用。先修切换 + 补测试。
- 目标③依赖目标④：recentModels 在 switchProvider 成功后记录，切换必须先可靠。
- 目标①独立，可与目标③并行。
- 目标②依赖目标①③：首页要显示用量摘要（①）和常用模型（③），最后做。

### 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| 统一到 TS adapter 后，`dist/` 未同步导致 Web 找不到模块 | Web 切换全挂 | `npm run build` 确保编译；部署时严格按 `deployment-workflow` 记忆执行 |
| Gemini adapter 改动破坏现有 OAuth 用户 | Gemini 用户无法切换 | 补测试 + 保留 OAuth 场景的分支 |
| 删除 JS writer 后遗漏某个 agent | 该 agent 切换失败 | 9 个 agent 逐一实测清单 |
| 用量对接的 API 字段不准确 | 显示错误余额 | 每个 provider 用真实 key 测一次 |
| 首页改动太大用户不适应 | 体验回退 | 保留 Agent tab 作为入口，新增区块在下 |

### 涉及文件总览

**新增**：
- `src/web/frontend/src/components/home/UsageSummary.tsx`
- `src/web/frontend/src/components/home/FavoriteModels.tsx`
- `src/web/frontend/src/components/home/QuickTools.tsx`
- `src/web/frontend/src/components/shared/FavoriteButton.tsx`
- `tests/providers/adapters/{gemini,openclaw,workbuddy,zcode,hermes,kimi-code,opencode}.test.ts`
- `tests/web/switch-provider.test.js`

**修改**：
- `src/web/api/usage.js`（统一 kind + 新增 5 个 provider 查询）
- `src/web/api/providers.js`（统一走 TS adapter + 新增 favorite API + recentModels 记录）
- `src/web/frontend/src/components/usage/UsagePage.tsx`（订阅/充值 tab）
- `src/web/frontend/src/components/home/HomePage.tsx`（驾驶舱重构）
- `src/web/frontend/src/components/agent/AgentPage.tsx`（切换入口统一）
- `src/providers/adapters/{gemini,codex,claude}.ts`（bug 修复）
- `src/web/frontend/src/i18n/{zh,en}.ts`（新增 key + 清理孤儿）
- `src/web/frontend/src/styles/{home,usage}.css`（清理孤儿 + 新区块样式）

**删除**：
- `src/web/frontend/src/styles/quick-start.css`（134 行孤儿）
- `src/web/frontend/src/components/shared/ModelPickerModal.tsx`（90 行死代码）
- `src/web/api/providers.js` 中 9 个 JS writer 函数（约 300 行）

### 对标 cc-switch 的总结

| 维度 | cc-switch | OKIT 现状 | OKIT 目标 |
|---|---|---|---|
| 切换单一入口 | ✅ `write_live_snapshot` | ❌ TS+JS 双套 | ✅ 统一 TS |
| 原子写 | ✅ `.tmp` + rename | ❌ 直接覆盖 | ✅ 照抄 |
| 切换前 backfill | ✅ 读旧 live 回写 | ❌ 无 | ✅ 照抄 |
| Gemini 写 model | ✅ | ❌ 丢弃 | ✅ 修复 |
| Codex wire_api | ✅ 按 protocol | ❌ 硬编码 | ✅ 修复 |
| 测试覆盖 | 部分 | 极低 | ✅ 9 adapter 全覆盖 |
| 用量订阅/充值分类 | 脚本定义语义 | ❌ 无分组 | ✅ UI tab 切换 |
| 常用模型 | ❌ 无 | ❌ 无 | ✅ 超越 cc-switch |
| 首页驾驶舱 | ❌ 纯列表 | ❌ 纯切换器 | ✅ 超越 cc-switch |

**结论**：切换机制全面对齐 cc-switch（照抄），用量分类和常用模型/首页驾驶舱则**超越** cc-switch。
