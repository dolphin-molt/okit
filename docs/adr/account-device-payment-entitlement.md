# ADR-2：账号、设备、支付和 Entitlement 流程

> 状态：Draft r2（2026-08-15 第四轮评审修订 + 第五轮收口；配合商业化方案 v2.1 §4/§5）
> 前置：ADR-1（user_id / device_id 定义）。
> 定稿前置：LS webhook 沙盒全事件类型实测（§7）。

## 1. 决策

- 账号认证与 Vault 主密码**分离**；
- **无本地 License、无离线授权宽限**：云端 API 每次调用验证；客户端只缓存订阅状态供 UI 展示；
- 支付走 Lemon Squeezy：**服务端创建 Checkout、Webhook 以原始请求体验签 + 原始体哈希幂等、每日对账（subscriptions + 启用的一次性 orders/refunds）**；entitlement 表是 API 授权唯一真源，Subscription/Order 只是上游支付依据；
- 订阅状态以 **`subscription_updated`（catch-all）中的 Subscription 对象（`status`/`ends_at`）为权威**，细粒度事件仅作触发与运营信号——不维护"自定义事件→状态"映射表（官方文档：每个生命周期事件后都会随发 `subscription_updated`）。

## 2. 账号（Phase 0 最小集）

- 登录方式（任一起步，建议 Magic Link 先行）：Magic Link / 一次性验证码 / Passkey；
- `user_id` UUID，登录方式可重置，不影响加密数据（Phase 1 分离设计）；
- 无密码字段、无密码哈希——服务端不持有任何可撞库凭据。

## 3. 设备

| 项 | 设计 |
|---|---|
| 注册 | 首次登录后服务端分配 `device_id`，签发设备令牌（随机 256-bit） |
| 令牌存储 | 系统 Keychain / Credential Manager / libsecret；禁止普通 JSON |
| 吊销 | 设备管理页可吊销；吊销后该设备需重新登录。**吊销/解绑/退出登录只移除该设备的访问权，不删除任何云端数据**（Vault、AgentProfile、用量历史均保留）——"从所有设备删除密钥"是独立的 Vault 同步操作（ADR-4 墓碑） |
| 单设备多开 | 客户端单实例锁（见 ADR-3）+ 服务端按 `device_id` 限流兜底 |
| 认证 | 设备令牌 + 请求签名，配时间戳窗口防重放 |

## 4. 支付流程（Lemon Squeezy）

```text
1. 客户端：GET /billing/checkout（携带登录会话）
2. 服务端：校验登录态 → 调 LS API 创建 Checkout，
   custom[user_id] 由服务端注入 → 返回 checkout URL
3. 用户在 LS 托管页支付
4. LS → POST /webhooks/lemonsqueezy
   - 以【未经 JSON.parse 的原始请求体】计算 HMAC-SHA256 校验 X-Signature
   - 幂等键 = 原始请求体 SHA-256（LS 不保证提供顶层 event_id，
     不假设其存在；重复投递同哈希直接 200）
   - 处理逻辑见 §4.1
5. 客户端：订阅状态接口轮询/推送刷新 → UI 解锁
```

### 4.1 Webhook 处理逻辑（以订阅对象为权威）

**主路径（catch-all）**：收到 `subscription_updated` → 读 Subscription 对象 → 按下表**定死的映射**写入 entitlement（覆盖官方全部 **7** 个 status；"cancelled 已过 ends_at"是附加兜底条件，不是第 8 个 status）：

| LS Subscription `status` | 服务端 entitlement | 说明 |
|---|---|---|
| `on_trial` | active | 试用期内 |
| `active` | active | 正常订阅 |
| `past_due` | **grace_active** | 支付失败进入催收重试期：**保留权益**（宽限），随 `subscription_payment_recovered`/`subscription_payment_success` 后的 `subscription_updated` 恢复 active；持续失败最终转 `unpaid` |
| `unpaid` | **revoked** | 催收全部失败；⚠️ 未开启 dunning 时可能**长期停留 unpaid、不会自动变 expired**——收到即撤权，不等待 |
| `cancelled` | active 至 `ends_at` | 用户已付期内不剥夺 |
| `expired` | revoked | 到期 |
| `paused` | 暂停期按 expired 处理，到 `pause.resumes_at` 后随 `subscription_updated` 恢复 | 字段是嵌套的 **`pause.resumes_at`**（不是顶层 `pause_resumes_at`）；`pause.mode` 影响的是计费期处理，不改变"暂停期停权益"这条规则 |
| （附加兜底）`cancelled` 且已过 `ends_at` | revoked | 防漏：cancel 后未收到 expired 事件的交叉兜底 |

**细粒度事件（触发/运营信号，不直接决定状态）**：`subscription_created` / `subscription_cancelled` / `subscription_resumed` / `subscription_expired` / `subscription_paused` / `subscription_unpaused` / `subscription_payment_success` / `subscription_payment_failed` / `subscription_payment_recovered` / `subscription_payment_refunded`——处理方式一律为"触发一次订阅对象重新拉取/以随发的 `subscription_updated` 为准"；`subscription_payment_failed` 仅用于运营提醒（邮件），不作为撤权依据。

**一次性年付（若启用）**：`order_created` 不直接授权——校验商品/Variant 属于年付目录、`status=paid`、该订单未处于退款状态后，**由 OKIT 服务端按内部产品配置计算权益期**：`entitlement.expires_at = order.created_at + 配置时长（年付 = 365 天）`，存入自己的 entitlement 表。**Order 对象没有 `expires_at` 字段**，不得假设存在；`order_refunded` → 撤销并按剩余期处理。

**对账（每日）**：服务端拉 LS API 与本地状态比对，不一致以 LS 为准修正并告警（webhook 丢失的兜底）；**对账范围同时覆盖 subscriptions 与已启用的一次性 orders/refunds**（年付通道启用后）。

## 5. Entitlement 与 API 语义

- **entitlement 表 = API 授权唯一真源**（v2.1 第六轮修订：`subscription` 表无法覆盖一次性年付——Order 没有 Subscription）。Subscription 与 Order 只是**上游支付依据**，经 webhook/对账收敛进 entitlement：

```text
entitlement {
  user_id
  source_type: subscription | order
  source_id                    # ls_subscription_id 或 ls_order_id
  status: active | grace_active | revoked
  starts_at
  expires_at                   # 订阅=ends_at；年付=order.created_at + 配置时长
  source_updated_at            # 上游对象最近更新时间（对账用）
}
```

- 每个云端 API 在网关/中间件统一校验，错误码区分：**未认证/无效设备令牌 → 401；已认证但无 Pro 权益（或已过期）→ 403 + 明确错误码**；
- 客户端缓存的订阅状态只用于 UI（横幅、升级引导），过期显示"状态可能过期"，不做任何授权判定；
- 定价（¥39/月、¥299/年、$7/月、$59/年）为**首发假设**，字段化配置，不改代码可调。

## 6. 中国用户续费问题（实测项，不是结论）

LS 一次性支付支持支付宝/微信；**订阅产品不支持**。应对顺序：

1. Phase 0 观察首批付费地域分布；
2. 若国内占比高：优先验证「年付一次性 + 到期提醒手动续费」路径（LS 一次性支持支付宝，授权规则见 §4.1），其次国内通道（面包多等，合规项见主方案 §10）；
3. 不在 Phase 0 同时建两套支付。

## 7. 验收

- [ ] 伪造 `custom[user_id]` 的 Checkout 路径不存在（客户端只能从服务端拿 URL）；
- [ ] 验签使用原始请求体（JSON 重序列化后签名不一致的用例）；
- [ ] 同原始体重复投递幂等（同 SHA-256 直接 200，无重复副作用）；
- [ ] `subscription_updated` 收敛路径覆盖全部 7 个官方 status + cancelled 过期兜底；
- [ ] `past_due` 宽限保留权益、`unpaid` 即刻撤权（含未开启 dunning 长期 unpaid 场景）；
- [ ] paused 用 `pause.resumes_at` 恢复、`pause.mode` 不影响停权益规则的用例；
- [ ] 退款（subscription_payment_refunded / order_refunded）撤权用例；
- [ ] 一次性年付校验链（商品/Variant/paid/退款状态）+ `expires_at = order.created_at + 365 天`计算用例（不假设 Order 对象有 expires_at）；
- [ ] entitlement 统一模型：subscription 与 order 双 source_type 写入同一授权表，403 判定只读 entitlement；
- [ ] 401 vs 403 接口矩阵测试；
- [ ] 每日对账纠偏测试。
