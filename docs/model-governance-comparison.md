# 模型管控对标差距分析

> 2026-08-10 · 基于 `feat/model-governance` 分支

## 一、对标对象

| 产品 | 定位 | Star / 规模 | 参考链接 |
|------|------|------------|---------|
| **CC Switch** | 跨平台桌面 All-in-One,AI CLI 工具配置管理 | 49K+ stars,GitHub Trending #1 | [farion1231/cc-switch](https://github.com/farion1231/cc-switch) |
| **LiteLLM** | 业界事实标准的 LLM 网关/代理,统一 API 接入 100+ 模型 | 生产级开源 | [docs.litellm.ai](https://docs.litellm.ai/docs/simple_proxy) |
| **OKIT**(本项目) | CLI + Web Dashboard,AI agent 基础设施管控 | — | — |

CC Switch 和 OKIT 在**同一个赛道**(agent 配置管理工具),直接竞争;LiteLLM 在**相邻赛道**(运行时网关),定位不同但能力有交叉。

---

## 二、功能对比矩阵

### 2.1 Agent / 工具支持

| 工具 | OKIT | CC Switch |
|------|------|-----------|
| Claude Code | ✅ | ✅ |
| Codex | ✅ | ✅ |
| Gemini CLI | ✅ | ✅ |
| OpenCode | ✅ | ✅ |
| OpenClaw | ✅ | ✅ |
| Grok Build | ✅ (xAI provider) | ✅ |
| Hermes Agent | ✅ | ✅ |
| ZCode | ✅ | ❌ |
| WorkBuddy | ✅ | ❌ |
| Kimi Code | ✅ | ❌ |
| Claude Desktop | ❌ | ✅ (v3.15.0) |

**小结**:Agent 数量 OKIT 领先(9 vs 8),且独有 ZCode/WorkBuddy/Kimi Code。CC Switch 独有 Claude Desktop 集成。

### 2.2 Provider 管控能力

| 能力 | OKIT | CC Switch | LiteLLM |
|------|------|-----------|---------|
| 预设 Provider 数 | **28** | ~15(含聚合平台) | 100+(运行时) |
| 连接测试(红绿灯) | ✅ 本次修复后全通 | ✅ 有(401/403 诊断) | ✅ 有 |
| 动态拉取模型列表 | ✅ 本次修复后全通 | ✅ 有(`/v1/models`) | ✅ 有 |
| 多端点(同一 provider 多 protocol) | ✅ `endpoints[]` 数组 | ✅ | ✅ |
| OAuth 登录(Codex/Anthropic) | ✅ 本次补齐 OAuth 测试 | ✅ | N/A |
| Provider 分组/筛选 | ✅ (group/protocol/plan/platform) | ✅ | N/A |

### 2.3 API Key 管理

| 能力 | OKIT | CC Switch | LiteLLM |
|------|------|-----------|---------|
| Key 加密存储 | ✅ **AES-256-GCM**(机器绑定密钥派生) | ❌ 明文 JSON | ✅ 有 |
| **自动创建 Key**(浏览器扩展一键开 key) | ✅ **22 平台** | ❌ 无 | ❌ 无 |
| Key 绑定项目(注入 .env) | ✅ | ❌ | ❌ |
| Key 云同步 | ✅ | ❌ | ✅ |
| Key 影响分析(checkKeyImpact) | ✅ | ❌ | ❌ |
| Key 轮转/多 Key 轮询 | ❌ 单 Key | 部分 | ✅ **核心能力** |

### 2.4 运行时网关能力(LiteLLM 赛道)

| 能力 | OKIT | CC Switch | LiteLLM |
|------|------|-----------|---------|
| **自动故障转移(failover)** | ❌ | ✅ 有 | ✅ **核心能力** |
| **用量追踪 / 成本统计** | ❌ | ✅ 有 | ✅ **核心能力** |
| **负载均衡(多 key/provider)** | ❌ | 部分 | ✅ **核心能力** |
| **请求路由 / 重试策略** | ❌ | ❌ | ✅ **核心能力** |
| **统一代理入口(一个 endpoint)** | ❌ | ❌ | ✅ **核心能力** |
| **速率限制 / 配额管理** | ❌ | ❌ | ✅ |
| **请求日志 / 审计** | ❌ | 部分 | ✅ |

### 2.5 用户体验 / 工程化

| 能力 | OKIT | CC Switch | LiteLLM |
|------|------|-----------|---------|
| 配置导入/导出 | ✅ | ✅ | N/A |
| 跨平台(macOS/Linux/Windows) | ✅ | ✅ | ✅ |
| Web UI | ✅ 浏览器 Dashboard | ❌ 纯桌面 App | ✅ Admin UI |
| CLI | ✅ Commander.js | ❌ | ✅ |
| 会话历史保护 | ❌ | ✅ (切换时防丢) | N/A |
| i18n(中/英) | ✅ | ✅ | ✅ |

---

## 三、差距总结

### 3.1 OKIT 的优势(保持)

1. **API Key 自动创建**(22 平台,浏览器扩展)— 这是 OKIT 最深的护城河,CC Switch 和 LiteLLM 都没有
2. **加密 Key Vault** — CC Switch 仍是明文配置,OKIT 的 AES-256-GCM + 机器绑定是安全层面的优势
3. **Agent 覆盖面** — 9 个 agent 含独家 ZCode/WorkBuddy/Kimi Code
4. **双形态(CLI + Web)** — 比 CC Switch 纯桌面 App 更灵活

### 3.2 OKIT 的欠缺(分优先级)

#### 短期可补(1-2 个迭代)

| 欠缺项 | 影响 | 建议方案 |
|--------|------|---------|
| **用量追踪/成本统计** | 用户无法知道哪个 provider/agent 花了多少钱 | 本地化方案:解析 agent 日志 or provider usage API,在 Dashboard 展示 |
| **会话历史保护** | 切换 provider 时可能丢 Claude Code 对话 | 切换前自动备份 `~/.claude/projects/` 的会话文件 |
| **Key 轮转** | 单 Key 容易触发 rate limit | Vault 支持同一 provider 存多个 Key,调用时轮询 |
| **预设双份维护** | presets.ts 和 providers.js 手工同步易漂移 | 见任务 5(单独评估构建流程改造) |

#### 长期架构(需要决策)

| 欠缺项 | 影响 | 建议方案 |
|--------|------|---------|
| **统一代理网关** | 无法做 failover / 负载均衡 / 统一入口 | **方案 A**:集成 LiteLLM 作为可选后端,OKIT 作为其管控面板<br>**方案 B**:自建轻量 proxy(Node.js,复用现有 provider adapter) |
| **自动故障转移** | provider 挂了不能自动切 | 依赖网关方案;代理层在收到 5xx/超时后按策略重试下一个 provider |
| **请求路由策略** | 无法按模型/成本/延迟路由 | 网关层支持 model alias 映射 + 优先级路由 |

### 3.3 关键决策点

> **OKIT 要不要做成"网关"?**

这是本次分析后最核心的架构决策:

- **做**(方案 A/B):补齐 failover/负载均衡/统一入口,与 LiteLLM 正面竞争。但工程量大,且偏离现有"配置管理工具"定位。
- **不做**:保持"配置管控"定位,与 LiteLLM **互补**——OKIT 管 key 和 agent 配置,LiteLLM 管运行时路由。可以把 LiteLLM 作为 OKIT 的一个 provider 预设(当前已有),让用户按需启用。

CC Switch 的路径给出了参考:它从纯配置工具起家,正在逐步补 failover 和用量追踪,向"轻量网关"方向延伸。OKIT 可以走同样的渐进路线——先补用量统计和会话保护(低风险),网关能力作为后续可选模块。

---

## 四、本次修复明细(feat/model-governance 分支)

| 修复项 | 文件 | 变更 |
|--------|------|------|
| Coding Plan 探测模型 bug | `vault.js` + `endpoint-profiles.js`(新) | `gpt-4o-mini` 硬编码 → 按 baseUrl 匹配 plan-specific 模型 |
| Coding Plan 模型拉取 fallback | `providers.js` | `/models` 失败时探测 chat 端点,成功返回预设模型列表 |
| OAuth provider 连接测试 | `vault.js` | `openai-codex` 新增 `probeCodexOAuth()`,读 `~/.codex/auth.json` 验证 |
| opencode adapter Web apply | `providers.js` | `applyAgentConfig` 补 `case 'opencode'`,新增 `applyOpenCodeConfig()` |

### 影响的 Provider 连通性(修复前 → 修复后)

| Provider | 修复前测试连接 | 修复前同步模型 | 修复后 |
|----------|--------------|--------------|--------|
| glm-coding | ❌ 假阳性失败 | ❌ 失败 | ✅ 通 |
| minimax-coding | ❌ 假阳性失败 | ❌ 失败 | ✅ 通 |
| volcengine-coding | ❌ 假阳性失败 | ❌ 失败 | ✅ 通 |
| tencent-coding | ❌ 假阳性失败 | ❌ 失败 | ✅ 通 |
| kimi-coding-plan | ❌ 假阳性失败 | ❌ 失败 | ✅ 通 |
| xiaomi-coding | ⚠️ 部分(/models 可能不通) | ❌ 失败 | ✅ 通 |
| openai-codex | ❌ 无 OAuth 测试 | N/A | ✅ 通 |
| opencode agent | ⚠️ 选中不写配置 | N/A | ✅ 通 |
| 其余 20 个 | ✅ 已通 | ✅ 已通 | ✅ 不变 |

---

## 五、参考链接

- [CC Switch GitHub](https://github.com/farion1231/cc-switch)
- [CC Switch 添加 Provider 文档](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/2-providers/2.1-add.md)
- [LiteLLM 文档](https://docs.litellm.ai/docs/simple_proxy)
- [Portkey AI Gateway](https://github.com/portkey-ai/gateway)(备选网关方案)
