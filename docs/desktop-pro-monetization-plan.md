# OKIT 商业化方案 v2.1 — OKIT Local（免费）+ OKIT Cloud Pro

> 状态：**v2.1 决策基线**（2026-08-15），融合 ZCode 初稿 + Codex 两轮评审 + 第三轮修正（8 项）+ 第六轮协议收口；**同日追加"Secure Environment"第二支柱决策**（§6B/ADR-5）。
> 本文档自包含，供协作方（人类/Agent）无上下文阅读与执行。
> v1 已废弃（见 §0）；v2 → v2.1 修订见 §0.5。
> 进入开发前需补齐五份技术文档（§12），完成后冻结为可拆任务、可验收的实施版本。

## 0. v1 → v2 关键修订

| # | v1（已废弃） | v2 | 理由 |
|---|---|---|---|
| 1 | 付费载体为"桌面版 Pro"（Electron 壳收费） | Electron 及全部本地能力永久免费，收费载体为 **OKIT Cloud** 托管服务 | cc-switch 免费竞品约束下，卖服务不卖功能；Electron 只是采集载体与分发形态 |
| 2 | 认为"本地用量/趋势/同步"是护城河 | 护城河重新评估（见 §1 v2.1 修正） | 经核实 cc-switch 已有用量看板（趋势/请求日志）+ BYO 云同步 + 本地代理，本地能力同质 |
| 3 | Pro 含"auto-create 批量流、备份" | 删除，本地功能一律免费 | 与"功能免费、服务收费"原则自洽（v1 自相矛盾） |
| 4 | Phase 0 = Electron + 激活码（近零服务端） | **Phase 0 = Cloud Monitor 付费 MVP**（含 OKIT Cloud 最小服务端） | 先做收银台再做商品不成立：本地功能全免费时，激活码无商品可解锁 |
| 5 | 激活码为主要授权机制（Ed25519 验签） | Webhook 自动绑定账号权益；**不做 Ed25519** | 账号已登录时复制激活码体验差；自签体系需要私钥托管/签发服务，与轻服务端矛盾 |
| 6 | `desktop/` 目录 + `OKIT_PRO` 构建隔离 | 单一客户端、单一安装包，无构建隔离；服务端 API 是唯一授权边界 | 客户端不是安全边界；Free/Pro 同包升级即解锁，免双构建双测试 |
| 7 | 含 Team 档定价 | **当前完全不做 Team**（不出现在路线图与定价页） | 组织/席位/轮换/审计体系放大复杂度，个人付费未验证前不应投入 |
| 8 | "收款走第三方页面即无需备案" | 改为合规待确认清单（§10） | 原结论过满，经营性边界需逐项确认 |
| 9 | 登录密码与主密码合一（双 KDF 分叉） | 账号认证（Magic Link/验证码/Passkey）与 Vault 主密码**分离** | 服务端重置登录方式不影响加密；避免弱密码同时成为账号与加密双弱点 |

## 0.5 v2 → v2.1 关键修正（2026-08-15 第三轮评审）

| # | v2 原表述 | v2.1 修正 | 落点 |
|---|---|---|---|
| 1 | "官方 API 级额度查询"为竞品没有的独家差异 | cc-switch 已支持 Claude/Codex/Gemini/Copilot 及 Kimi/GLM/MiniMax/DeepSeek/StepFun/OpenRouter 等额度或余额查询；OKIT 差异是**覆盖度、准确性、浏览器会话采集、官方托管的历史/告警/多设备服务**，结构性差异是 OKIT Cloud | §1 |
| 2 | "15 平台"口径 | 实测 `src/web/api/usage.js` 的 `SUPPORTED` 为 **37 个 provider ID / 19 个平台品牌**；统一口径为"覆盖 19 个平台品牌、37 个订阅/余额查询标识"，禁止品牌数/产品数/ID 数混用 | §1 |
| 3 | "LS 不支持支付宝" | LS **一次性支付**支持支付宝/微信；**订阅产品**当前仅银行卡/Apple Pay/Google Pay/PayPal——国内自动续费转化需实测 | §5 |
| 4 | Phase 0 含客户端本地 License + 7 天离线宽限 | **删除**。付费能力全在云端，离线本就无法调用；改为登录 + 服务端 entitlement + 客户端缓存订阅状态（仅 UI 展示） | §4/§5 |
| 5 | 事件用本地随机 `account_id` | 改为**稳定 Provider 账号身份**：每 Provider 账号持随机 `provider_account_id` + 用户别名，云端唯一性 `user_id + provider_account_id`，多设备首次发现同账号由用户合并或经加密账号映射同步 | §3/§4 |
| 6 | 后台采集只写"托盘、后台运行" | 增加**跨平台验收条件**（托盘隐藏/彻底退出/开机启动/单实例锁/休眠恢复/断网重试/幂等 ID/失败不弹窗），针对 `main.ts:138` Win/Linux 关窗即退出的现状 | §4 |
| 7 | "云端永远收不到 Key/Cookie"仅写在验收标准 | 升级为**可验证技术约束**：字段白名单、服务端拒未知字段、体积限制、客户端敏感字段检测、日志脱敏、注入测试、Keychain 存设备令牌、接口限流/设备认证/幂等/防重放 | §3/§4 |
| 8 | Phase 1 强制第二台设备恢复验证；注销/导出留到 Phase 2 | 迁移改为**当前设备独立临时上下文校验**（第二台设备为可选演练）；**注销、云端数据删除、保留周期、隐私说明、基础导出提前到 Phase 0**（Cloud Monitor 从 Phase 0 起收集个人数据） | §4/§6 |

支付流程同步补四项实现约束（服务端创建 Checkout、webhook 验签+幂等、定期对账、entitlement 表为授权唯一真源——subscription/order 双上游），定价改为"首发假设"，见 §5。

## 1. 背景与约束（2026-08-15 实测核实）

**竞品现状（cc-switch，127.3k star，8.7k fork）**：用量看板（趋势图/请求日志/自定义模型单价）、**官方额度/余额查询**（Claude、Codex、Gemini、Copilot、Kimi、GLM、MiniMax、DeepSeek、StepFun、OpenRouter 等）、BYO 云同步（Dropbox/OneDrive/iCloud/WebDAV）、本地代理（格式转换/故障转移/熔断/健康监控）、MCP/Prompts/Skills 管理、会话历史、深链接、托盘——功能面仍在快速膨胀。

推论（v2.1 修正后）：

- 本地用量、本地趋势、BYO 同步、**官方额度查询本身**均已同质，**查询"有没有"不可作为付费点或独家宣传**；
- OKIT 的差异化在于：① 额度查询的**覆盖度与准确性**（37 个 provider ID，见下）② **浏览器会话型/控制台型平台采集**（依赖本地采集器 + 扩展基础设施，代理日志无法推算订阅额度）③ **官方托管云服务**——云端历史、告警路由、多设备查看、零知识同步（cc-switch 仅 BYO）④ 团队治理（远期）；
- **真正结构性的差异是 OKIT Cloud**；查询适配数量只是阶段性领先，不是护城河；
- **口径规范**：对外统一表述"覆盖 19 个平台品牌、共 37 个订阅/余额查询标识"（实测 `src/web/api/usage.js` `SUPPORTED`：anthropic、openai-codex、openai、anthropic-agent、xai-grok-build、github-copilot、glm-coding、zai-global-coding、kimi-coding-plan、minimax-coding/minimax-global-coding、minimax/minimax-global、zai/zai-global、kimi-coding、openrouter、volcengine 三档、qwen 系列 3 项、qianfan 两项、tencent 两项、opencode-go、xiaomi 两项、xai、stepfun 两项、deepseek、siliconflow、moonshot、mistral）。定价页/产品页引用时禁止"平台品牌数 / 订阅产品数 / provider ID 数"混用；
- **窗口期**：cc-switch 补齐托管云只是时间问题，Cloud Monitor 的先发优势有时效性，方案冻结后应尽快交付。

**逐平台矩阵（持续维护，取代"15 平台领先"式营销结论）**：

| Provider | OKIT 数据源 | cc-switch 状态 | 是否需扩展 | 可否后台采集 | 稳定性 |
|---|---|---|---|---|---|
| anthropic-agent | API | 已支持 | — | 可 | 高 |
| （逐平台填写，Phase 0 前建成） | | | | | |

**仓库现状**：Electron 壳已存在（`src/electron/main.ts` + `app:dev/app:build/app:dist/app:install`）；**当前 `main.ts:138` 在 Windows/Linux 关闭全部窗口后 `app.quit()`，无托盘驻留**（§4 验收项据此立项）；vault 实现为首次机器指纹派生后**明文 hex 持久化** `~/.okit/vault/master.key`（`src/vault/store.ts:43`），安全模型实质是文件系统权限（详见 §6 迁移）。

## 2. 产品定位与版本划分

一句话定位：

> **OKIT 是个人 AI 开发者的账号、订阅额度、密钥和设备控制中心。**

回答用户的真实问题：我还有哪些 Claude/Codex/GLM/Kimi 额度可用？哪个账号即将耗尽或重置？今天该把任务放到哪个账号？不打开主窗口能否持续采集并告警？换电脑能否快速恢复密钥与配置？

当前只保留两档：

| 版本 | 能力 | 价格 |
|---|---|---:|
| **OKIT Local** | Electron、CLI、Web、Vault、Provider/模型/Agent 管理、auto-create、本地用量查询/轮询/浏览器通知、backup、BYO 同步 | **免费，永久** |
| **OKIT Cloud Pro** | **两根支柱**——① Cloud Monitor：云端用量历史、远程告警、多设备查看、设备管理；② Secure Environment：Vault 零知识多设备同步、AgentProfile 云端备份、新设备一键恢复、配置历史与回滚 | 首发假设：¥39/月、¥299/年；海外 $7/月、$59/年，**根据首批真实付费与续费数据调整** |

铁律：所有已有本地功能不因未订阅而失效；Pro 收费点必须依赖真实云端服务；早期用户可做首年优惠，**不做永久买断**。

**两根支柱的产品叙事**：

```text
OKIT Cloud Pro
├── Cloud Monitor      —— 用量历史 / 远程告警 / 多设备查看
└── Secure Environment —— Vault 密钥同步 / AgentProfile 备份 / 新设备一键恢复 / 配置历史回滚
```

对外文案：**"一次配置，在所有设备上使用。登录 OKIT，即可恢复密钥、Provider、模型和 Agent 环境。"**（短版："换一台电脑，也能立即恢复你的 AI 开发环境。"）产品概念：**AI 开发环境漫游**。仍是个人 Pro 能力，不涉及 Team、组织、席位与权限体系。

## 3. 第一个付费产品：Cloud Monitor

用量查询/轮询/本地通知已免费可用，**不可对"查询"本身收费**。Pro 卖的是用量数据之上的持续服务：

- 30/90 天历史趋势；多设备查看；多账号聚合；
- 自定义阈值 + 远程告警（飞书/Webhook/邮件）；
- 主窗口关闭后由后台进程继续采集；
- 告警去重、恢复通知、每日摘要；
- 云端查看全部账号状态（后续移动 Web）。

### 架构：本地采集、云端管理

```text
Provider API / 本地 CLI / 浏览器登录态
                    ↓
             OKIT 本地采集器（Electron 后台进程/托盘）
                    ↓
       标准化用量事件 —— 不上传 Key / Cookie / Token / 页面内容
                    ↓
                   OKIT Cloud
                    ↓
       历史趋势 / 告警路由 / 多设备查看
```

上传事件示例（与 ADR-1 契约一致；`provider_account_id` 为稳定身份，账号别名存于 provider_account 表、不随事件重复）：

```json
{
  "event_id": "uuid-v4（幂等去重用）",
  "provider_id": "example",
  "provider_account_id": "首次发现该 Provider 账号时生成的稳定 UUID",
  "kind": "subscription",
  "window_type": "weekly",
  "used_percent": 68,
  "remaining_minor": null,
  "currency_code": null,
  "remaining_quantity": "12345.6789",
  "quantity_unit": "token",
  "reset_at": "2026-08-18T00:00:00Z",
  "collected_at": "2026-08-15T10:00:00Z",
  "source": "local-api"
}
```

（货币型余额用 `remaining_minor` + `currency_code`，非货币型用 `remaining_quantity`（十进制字符串）+ `quantity_unit`，两组互斥——详见 ADR-1。）

**禁止上传**：API key、Cookie、OAuth token、浏览器页面内容、Provider 原始响应中的不必要个人信息。

**"不会上传密钥"的可验证技术约束（v2.1 升级为产品承诺，双端强制）**：

1. 用量事件采用**严格字段白名单**（JSON Schema 校验），服务端**拒绝任何未知字段**（422，不落库）；
2. 限制请求体大小（单事件与批量上限）；
3. 客户端上传前运行**敏感字段检测**（字段名与值模式：`api_key`、`cookie`、`token`、`sk-`/`tp-` 前缀等），命中即拦截并记录本地错误；
4. 服务端日志统一脱敏（结构化日志白名单输出，禁止 dump 请求体）；
5. 错误上报**不得包含 Provider 原始响应体**（只传错误码与标准化消息）；
6. **自动化测试**：向事件中注入 `api_key`/`cookie`/`token` 字段与值，断言客户端拦截与服务端 422 双端拒绝（CI 必跑）；
7. 设备令牌存系统 **Keychain / Credential Manager / libsecret**，不放普通 JSON；
8. 上传接口具备**速率限制、设备认证、幂等（event_id 去重）与重放控制**（时间戳窗口 + nonce）。

**诚实宣传约束**：完全退出 OKIT 或电脑离线后本地采集停止。"持续监控"指窗口关闭但后台进程仍在运行，不得宣传为无需任何在线设备的全天候云端监控。未来确有全天候需求的用户，可另提供"自愿托管凭证"模式，**不得与零知识模式混淆**。

## 4. Phase 0：Cloud Monitor 付费 MVP

范围：

- Electron **后台驻留改造**（针对 `main.ts:138` 现状，见下方验收条件）；
- OKIT 账号（Magic Link / 验证码 / Passkey 任一起步）；
- Lemon Squeezy 支付 + 云端 entitlement（实现约束见 §5）；
- 本地用量采集器 + 云端 30 天历史；
- 自定义用量阈值 + **一个**外部告警渠道（建议飞书或 Webhook 二选一先做）；
- 多设备查看；订阅状态自动刷新；
- **账号身份与多账号聚合基础**（见下）；
- **隐私底线能力**（v2.1 从 Phase 2 提前）：云端用量数据删除、账号注销、明确保留周期、隐私说明、基础数据导出（JSON）。

**v2.1 删除项**：客户端本地 License、License Key API 补充路径、7 天离线授权宽限。理由：全部付费能力在云端，离线时本就无法调用云服务，无本地 Pro 功能需要解锁；客户端只缓存上次订阅状态用于 UI 展示（如"Pro 已过期"横幅），云端 API 每次调用都验证访问权限。缓存的历史用量数据可离线查看，无需 License。未来若出现付费本地能力，再设计离线 entitlement。

**Provider 账号身份设计（v2.1 新增，Cloud Monitor 数据模型必要字段）**：

- 每个 Provider 账号在**首次被发现**时生成随机 `provider_account_id`（UUID v4），**不使用 API key hash、Cookie hash 等可变/可枚举值作身份**（key 轮换会导致身份漂移）；
- 用户可为账号设置别名（`account_alias`，存于 provider_account 表），仅本地与云端展示用；
- 云端唯一性约束：`user_id + provider_account_id`；
- 多设备**首次**发现"疑似同一账号"（同 provider_id + 相近特征）时，由**用户确认合并**，或经加密账号映射同步自动对齐；不自动合并，避免误聚；
- 账号删除（本地解绑）时云端保留墓碑，防止重新发现时生成重复身份。

**Electron 后台采集验收条件（v2.1 新增，逐条可测）**：

1. 关闭窗口时**隐藏到托盘**（三平台），托盘菜单提供明确的"彻底退出"；
2. 可选开机启动（默认关，用户显式开启）；
3. **单实例锁**（second-instance 唤起已有窗口），同一设备不启动多个采集器；
4. 系统休眠/睡眠恢复后**重新调度**采集任务（powerMonitor resume 事件）；
5. 网络恢复后重试失败的上传（指数退避），采集失败进入本地队列不丢失；
6. 事件携带 `event_id`，服务端幂等去重——重试**不得**产生重复趋势数据；
7. 后台采集失败**不弹窗骚扰**，集中显示在状态页/托盘 tooltip；
8. Windows/Linux 验收基准：关闭主窗口 10 分钟后进程仍在、采集日志持续；点击"彻底退出"后进程消失且不再采集。

完成标准（验收线）：

1. 未登录、未付费用户的全部本地功能正常；
2. 云端永远收不到 Provider Key 与 Cookie（以 §3 技术约束的自动化测试为证，CI 通过）；
3. 第二台设备登录后可见已有用量历史（开发验证用；**产品不强制用户双设备**）；
4. 关闭窗口保留后台进程时，采集与告警继续（按上述 8 条验收）；
5. 订阅取消/到期后仅云服务停止，本地数据与功能不受影响；
6. 支付完成后客户端自动识别权益，无需用户手动复制激活码或重复操作；
7. 用户可自助删除云端用量数据并注销账号，删除在保留周期说明内生效。

## 5. 支付与权益设计

第一阶段**只接 Lemon Squeezy**（个人可注册、MoR 代缴全球税务、5%+$0.5），不同时建设国内外两套支付。

流程（webhook 自动绑定）：

```text
用户登录 OKIT → 点击升级 → 服务端（已登录会话）创建 Lemon Squeezy Checkout 并绑定 user_id
    → 用户在 LS 托管页支付 → Webhook（验签）更新云端 entitlement → 客户端自动刷新订阅状态
```

**支付实现约束（v2.1 新增，全部为硬性要求）**：

1. **Checkout 由服务端创建**：客户端不得自行填写 `user_id`/自定义字段后直接信任；Checkout 的 `checkout[custom][user_id]` 由服务端通过已登录会话注入（或签发一次性绑定 token）；
2. **Webhook 验签**：以**未经 JSON 解析的原始请求体**校验 `X-Signature`（HMAC-SHA256），失败丢弃并告警；
3. **Webhook 事件幂等**：LS 不保证提供顶层 `event_id`，幂等键 = **原始请求体 SHA-256**，重复投递直接 200；
4. **订阅状态以 `subscription_updated`（catch-all）中的 Subscription 对象为权威**（status/ends_at 整体收敛），细粒度事件仅作触发；支付失败进入催收期不立即撤权，随 `subscription_payment_recovered` 恢复；
5. **定期对账**：每日与 LS API 对账（subscriptions + 启用的一次性 orders/refunds），纠正漏报/错报；一次性年付订单须校验商品/Variant/支付状态/退款状态，`expires_at` 由 OKIT 按 `order.created_at + 配置时长` 自算；
6. **entitlement 表 = API 授权唯一真源**（`source_type = subscription | order`），不信任客户端任何声明；客户端缓存的订阅状态仅用于 UI，权限判定一律以 API 响应为准。

权益边界：

- **服务端 API 是最终授权边界**：未订阅用户不能调用云端历史/同步/告警接口；客户端被修改也无法绕过；
- 客户端仅缓存上次订阅状态用于展示（离线时显示"状态可能过期"）；
- **第一阶段不做自定义 Ed25519、不做本地 License**（v2.1 从 v2 进一步收敛）。

**国内支付（待验证，不写确定结论）**：Lemon Squeezy **一次性支付**支持支付宝/微信；**订阅产品**当前仅支持银行卡、Apple Pay、Google Pay、PayPal（[官方支付方式文档](https://docs.lemonsqueezy.com/help/checkout/payment-methods)）——即**中国用户的自动续费转化仍需实测**，不能假设"LS 可收款=国内转化通畅"。主体要求、个人能否持续经营、结算周期、退款投诉流程、Webhook/API 能力、实际费率均需验证。**时机**：OKIT 用户画像约半数为国内平台，Phase 0 上线后应**按首批付费用户的地域分布**决定是否提前启动国内通道（含支付宝订阅的可行路径：LS 订阅不支持支付宝时，评估年付一次性 + 手动续费提醒，或国内通道）验证，不硬等 Phase 2。

**定价口径（v2.1）**：上表价格为**首发假设**，不是永久定价；依据首批真实付费/续费数据调整后另行冻结。

## 6. Phase 1A：Vault 零知识多设备同步（Cloud Monitor 验证付费后投入）

> 实施前必须先完成 §12-4 密码学 ADR。这是 Secure Environment 支柱的密钥同步部分。

### 认证与加密分离（否决"登录密码=主密码合一"）

- OKIT 账号：Magic Link / 验证码 / Passkey 登录，账号本身不要求记密码；
- Vault 主密码：只在本地派生 KEK，**服务端从未收到主密码及其可重放派生值**；
- 服务端重置账号登录方式，不能解密 Vault。

密钥结构：

```text
Vault 主密码 --Argon2id--> KEK --解包--> 随机账号 DEK --AES-256-GCM--> Vault 数据
高熵恢复密钥（随机生成） -------------------------- 包装另一份 DEK
```

云端保存：KDF 参数与 salt、wrapped DEK、密文、加密格式版本、设备与同步元数据——服务端**无法解密 Vault 内容**；但设备列表、记录数量、时间与大小等同步元数据对服务端可见，属于**敏感元数据**（隐私说明如实披露，见 ADR-4）。

忘记主密码：有恢复密钥 → 恢复并重设主密码；无恢复密钥 → 只能重置账号、旧 Vault 不可恢复；客服不能解密或恢复用户密钥。

### 同步协议：不做大 JSON Blob

每条密钥独立 ID、版本号、更新时间、**删除墓碑**、设备 ID、冲突检测、旧版本保留、防旧设备覆盖新数据、加密格式版本与 KDF 参数版本、可回滚迁移。

**设备相关数据不直接跨设备同步**：项目绝对路径（`ProjectBinding.projectPath`）只同步逻辑项目标识，每台设备重建本地路径映射。

### 多设备同步语义（无主设备）

- **不设固定"主设备"**：OKIT Cloud 是逻辑主节点，只负责版本排序（`server_revision + CAS`），**不负责解密**；所有设备都可提交修改；
- **删除也是一个版本**：`deleted=true` 墓碑，不立即物理删除；墓碑密文进入**加密回收站**，默认保留 30 天、可恢复（恢复 = 以新 revision 重新提交内容）：

```text
revision 10：Key A 存在
revision 11：设备 A 删除 Key A（墓碑 → 回收站）
revision 12：用户从回收站恢复 Key A（新 revision）
```

- **过期设备不能复活已删除密钥**：墓碑成为 head 后，落后设备任何提交都因 `base_revision` 落后收到 409（ADR-4 CAS 已保证）；
- **三个"删除/解绑"术语严格区分**（文档、UI、宣传统一用词）：

| 术语 | 含义 |
|---|---|
| **设备解绑** | 仅吊销该设备访问权；不删除任何云端数据（ADR-2） |
| **Provider 账号解绑** | 本地解除关联；云端保留墓碑与保留期内的历史（防重复身份，ADR-1），用户可在云端管理页清除 |
| **Vault 条目删除** | 创建墓碑，设备下次在线时同步删除状态（ADR-4） |

- **诚实宣传约束**：不得宣传"远程删除设备上的密钥"——离线设备或已被吊销的设备可能仍保留旧的本地副本。准确说法：**"删除状态同步到仍有权限且再次联网的设备"**。

### 现有数据迁移（v2.1 修订：不强制第二台设备，单机可完成）

1. 读取现有 `~/.okit/vault/master.key`（明文持久化，直接可读——现状利好，无需碰机器指纹）；
2. 解密现有 Vault；
3. 用户设置新的 Vault 主密码；
4. 生成随机 DEK，重新加密数据；
5. 上传 wrapped DEK 与密文；
6. **当前设备从云端重新下载，在独立临时上下文中完成解密与内容校验**（不覆盖现有数据）；
7. 制作**回滚包**：旧数据用新 DEK（或恢复密钥）加密后本地保存一份——这是唯一的回滚手段，**不再保留明文 `master.key`**；
8. 校验通过后切换新格式（先写后删），**立即删除原始 `master.key`**（不留 30 天明文滞留；与 ADR-4 一致）；
9. （可选）在第二台设备或定期恢复演练中重复验证——**不作为迁移硬门槛**。

⚠️ 实施前审计：`cloud-sync-core.js` 现有同步密码派生/本地存储机制、`updatedAt` 合并策略的删除/冲突行为。

## 6B. Phase 1B：AgentProfile 配置档案与新设备恢复

Secure Environment 支柱的第二部分。**核心策略：密钥与 Agent 配置采用不同同步策略**——Vault 密钥是结构化数据，走 Phase 1A 自动多设备同步；Agent 配置**第一版不做实时双向同步、不自动合并**，走"配置档案备份 + 用户主动恢复"，规避多设备实时冲突，同时解决"换设备重新配置一遍"的核心痛点。

两层架构：

```text
第一层：OKIT AgentProfile（逻辑配置，用户想要的 Agent 环境；DEK 加密上传，服务端不可读）
第二层：各 Agent 本机配置文件（由 Adapter 按 Agent 版本与操作系统生成）
```

- 一个 Agent 对应多个本机配置文件（如默认模型与模型列表分文件）时，云端只保存**一份逻辑 AgentProfile**，恢复时由 Adapter 投射到对应文件；
- 密钥**不写入** AgentProfile，只保存 Vault 引用（稳定 `vault_item_id` UUID + `display_alias` 展示用别名，**禁名称路径式引用**）；恢复时若 Vault 缺少对应条目 → 提示补充，不写无效配置；
- Adapter 四能力：`detect`（识别安装/版本/配置位置）、`capture`（提取 OKIT 支持字段）、`plan`（差异预览）、`apply`（备份后应用、失败回滚）；只修改 OKIT 管理的字段，保留用户其他配置；
- 恢复流程：登录 → 解锁 Vault → 下载解密 AgentProfile → 识别本机 Agent → **差异预览** → 用户点击"恢复到此设备" → 备份并生成配置；未安装的 Agent 跳过（`!` 标记），不产生错误配置；
- 用户在 Agent 外部改配置 → OKIT 检测差异并**提示**是否更新云端档案，无确认不自动覆盖；
- 第一版明确不包含：浏览器 Cookie/Session、OAuth 登录态、对话历史、日志缓存、项目绝对路径、可执行文件路径、整个 `~/.claude`/`~/.codex` 目录、实时自动双向同步、字段级自动冲突合并（后两者待需求验证后再考虑）。

数据模型、Adapter 接口、10 条验收标准详见 **ADR-5**（`docs/adr/agent-profile-backup-restore.md`）。

## 7. Phase 2：个人 Pro 完善

更多告警渠道；90 天/长期趋势；每日每周摘要；多账号分组；云端备份版本；移动 Web 查看；（账号注销、数据导出、隐私删除已提前至 Phase 0，此处仅做**增强**：导出格式扩展、删除即刻生效选项等）；国内支付验证（若未提前）。

## 8. 当前不做 Team

删除 v1 的全部 Team 内容：定价、席位计费、组织成员、管理员分发、团队聚合、角色权限、审计、离职撤权、密钥轮换。仅保留轻量未来扩展性：数据对象稳定 UUID、API 不硬编码用户 ID 到业务字段、预留通用 `owner_type`/`owner_id`（当前恒为 `user`）。**不建 Team UI，定价页不写"即将推出"**。

## 9. 代码组织：单客户端、无构建隔离

不新建 `desktop/` Pro 客户端，不依赖 `OKIT_PRO` 构建目标控制权益：

```text
okit/                     公开仓库（唯一 main 分支）
├── src/cli/  src/web/  src/electron/  src/vault/
└── src/cloud-client/     # Cloud 客户端模块，代码公开无妨
（一个公开客户端、一个安装包，Free/Pro 同包）

okit-cloud/               私有仓库（仅本人可见）
├── auth/  entitlement/  usage-events/  alerts/  sync/  billing-webhooks/
```

理由：桌面端不是安全边界；同一客户端同时服务 Free 与 Pro，用户升级后无需重新下载；服务端 API 才是最终授权边界；免双构建双更新双测试。构建目标仅区分开发/生产/渠道，不用于保护付费权益。

## 10. 合规待确认清单（不作为已确认结论）

- [ ] 自有官网/落地页部署位置与经营性/非经营性 ICP 边界；
- [ ] 海外服务存储中国用户数据的跨境合规；
- [ ] API key 的数据定级与重点保护义务；
- [ ] 桌面 App 是否涉及应用备案；
- [ ] Lemon Squeezy 与面包多的主体、结算、退款、地区可用性；
- [ ] 面包多个人/企业开店条件与实际费率；
- [ ] （v2.1）LS 订阅不支持支付宝情形下，国内年付一次性收款 + 手动续费的合规与税务路径。

## 11. 修改后的状态判断（v2.1）

| 部分 | 判断 |
|---|---|
| Local 免费、Cloud 收费 | 通过 |
| 当前不做 Team | 通过 |
| 单一客户端、服务端鉴权 | 通过 |
| Cloud Monitor 优先 | 通过 |
| 本地采集、云端管理 | 通过（补 §3 技术约束后） |
| 支付流程 | 补 §5 实现约束后通过 |
| 零知识同步方向 | 通过，但实施前必须单独形成密码学 ADR（§12-4） |
| Secure Environment 第二支柱（追加决策） | 方向通过：Vault 自动同步（1A）+ AgentProfile 备份恢复（1B），ADR-5 已建 |
| Agent 配置实时同步/自动合并 | **第一版不做**（用户主动备份/恢复，待付费验证） |
| "官方额度查询是独家差异" | **已改写**（§1：差异为覆盖度/准确性/浏览器采集/托管云） |
| Phase 0 本地 License | **已删除** |
| v2"定稿"状态 | **改为"v2.1 决策基线，待技术 ADR"** |

## 12. 进入开发前的五份短文档

1. **Cloud Monitor 数据模型与隐私边界**（`docs/adr/cloud-monitor-data-model.md`）；
2. **账号、设备、支付和 entitlement 流程**（`docs/adr/account-device-payment-entitlement.md`）；
3. **Electron 后台采集生命周期**（`docs/adr/electron-background-lifecycle.md`）；
4. **Phase 1A Vault 零知识同步密码学 ADR**（`docs/adr/zero-knowledge-sync-crypto.md`）；
5. **Phase 1B AgentProfile 配置档案与恢复 ADR**（`docs/adr/agent-profile-backup-restore.md`）。

完成这五份后，本方案从"决策基线"正式进入可拆任务、可验收的实施阶段。ADR 状态流转：**Draft（当前，r2 已吸收第四~六轮评审）→ 定稿前置（37 个 provider ID fixture 全绿 + LS webhook 沙盒实测 + 密码学 ADR 单独安全评审 + **ADR-5 真实 Agent 配置 POC**，见 ADR-5 §7）→ Accepted**。

**路线图（更新）**：

```text
Phase 0  ：Cloud Monitor 付费 MVP（验证真实付费）
Phase 1A ：Vault 零知识多设备同步
Phase 1B ：AgentProfile 配置档案、备份与新设备恢复
后续     ：实时 Agent 配置同步、智能冲突合并（需求充分验证后再考虑）
全程     ：完全不做 Team
```

## 13. 一句话结论

> **OKIT Local 永久免费，OKIT Cloud Pro 以两根支柱服务个人 AI 开发者——Cloud Monitor（用量历史/远程告警/多设备查看）+ Secure Environment（Vault 零知识同步/AgentProfile 备份/新设备一键恢复："一次配置，在所有设备上使用"）。Phase 0 直接交付可收费的 Cloud Monitor（无本地 License，隐私底线内建），验证付费后依次建 1A 密钥同步、1B 环境恢复，当前完全不做 Team。**
