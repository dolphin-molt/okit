# ADR-1：Cloud Monitor 数据模型与隐私边界

> 状态：Draft r2（2026-08-15 第四轮评审修订 + 第五轮收口；配合商业化方案 v2.1 §3/§4）
> 目标读者：OKIT Cloud 服务端与本地采集器实现者。
> 定稿前置：37 个用量 provider ID 各出至少一份 fixture，全部通过 canonical 转换测试（§7）。

## 1. 决策

- 本地适配器输出先经 **`canonicalizeUsageEvent()` 统一转换层**，再形成 Cloud UsageEvent v1——转换层吸收现有实现的全部合法变体，Cloud Schema 只对 canonical 后的事件生效；
- 严格白名单字段；服务端以 JSON Schema 校验并拒绝未知字段；
- 隐私边界（禁止上传的内容）以自动化测试强制执行，而非仅靠约定。

## 2. 转换层

```text
现有 provider adapter 输出（kind/window/标签存在平台自定义变体）
        ↓
canonicalizeUsageEvent()          # 本地库，随适配器单测
        ↓
Cloud UsageEvent v1（本 ADR Schema）
```

枚举与现有实现对齐（`src/web/api/usage.js` 实测：`UsageKind = { subscription, prepaid }`；窗口值含 `5h/7d/weekly/monthly/credits/limit`）：

- `kind`：`subscription` | `prepaid`
- `window_type`：`5h` | `7d` | `weekly` | `monthly` | `credits` | `limit` | `custom`（`custom` 时附 `window_label` 本地化标签，≤32 字符）

## 3. 事件模型（usage_event）

**客户端上传体**（不含身份字段——`user_id`/`device_id` 由服务端从认证信息注入，不信任请求体声明）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `event_id` | UUID v4 | 客户端生成，幂等去重键 |
| `provider_id` | string | OKIT preset ID（如 `volcengine-coding`） |
| `provider_account_id` | UUID v4 | 稳定 Provider 账号身份（§5） |
| `kind` | enum | `subscription` / `prepaid` |
| `window_type` | enum | §2 |
| `window_label` | string? | 仅 `custom` 时，本地化窗口标签 |
| `used_percent` | float? | 0–100 |
| `remaining_minor` | int? | **货币型余额**：最小货币单位整数（美分/分）；与 `currency_code` 成对出现 |
| `currency_code` | string? | `USD` / `CNY`（ISO 4217），仅货币型 |
| `remaining_quantity` | string? | **非货币型余额**：十进制字符串（如 `"1234.5678"`）——现有 token/credits 存在四位小数，字符串保留原精度、无损往返；禁浮点 |
| `quantity_unit` | string? | `token` / `credit` |
| `reset_at` | timestamp? | ISO 8601 |
| `collected_at` | timestamp | 客户端采集时刻；**历史时间**按保留期正常接收（离线积压事件发生在过去，不受限）；**未来**时间仅容忍时钟偏差 **±10 分钟**（超出 → 422，避免污染趋势与延迟告警） |
| `source` | enum | `local-api` / `browser-session` / `cli` |

**服务端补充字段**：`user_id`、`device_id`（认证注入）、`received_at`（服务端接收时刻）。

**金额模型约束（货币与非货币互斥）**：`remaining_minor + currency_code` 与 `remaining_quantity + quantity_unit` 二选一，Schema 层校验（两组同时出现或各自缺伴 → 422；仅上报 `used_percent` 时可全空）。货币缩放由 `currency_code` 定义（USD=×100、CNY=×100），无隐式缩放位数。

白名单外任何字段 → 服务端 422，事件整体拒绝，不落库、不部分接受。

**唯一约束**：`(user_id, event_id)`——幂等键含租户维度，避免跨用户 event_id 碰撞冲突。

## 4. 派生数据（服务端）

- `usage_daily`：按 `(provider_account_id, date)` 聚合的最新值快照；
- `alert_state`：阈值触发、去重键、恢复通知状态；
- 保留周期：原始事件 90 天，聚合 12 个月，账号注销后 30 天内物理删除（Phase 0 写入隐私说明）。

## 5. Provider 账号身份（provider_account）

| 字段 | 说明 |
|---|---|
| `provider_account_id` | 首次发现该 Provider 账号时客户端生成并注册到云端 |
| `account_alias` | **存于 provider_account 表**，不随每条事件重复存储 |
| 身份依据 | 随机 UUID，一次生成终身不变 |
| 明确禁止 | API key hash、Cookie hash、账号邮箱/手机号 hash 作为身份 |
| 本地发现特征 | provider_id + 本地 key 指纹等仅用于提示疑似重复，不作为身份 |
| 多设备对齐 | 用户确认合并；或经加密账号映射（Phase 1）自动对齐；不自动合并 |
| 删除 | 本地解绑 → 云端墓碑（防重复身份）；注销账号 → 物理删除 |

## 6. 隐私边界的强制执行与元数据声明

**敏感元数据声明（诚实边界）**：用量数值、平台（provider_id）、账号别名、采集时间对云端**可见**——它们属于 Cloud Monitor 的服务数据，**不在零知识加密范围内**（零知识只覆盖 Vault 密钥数据，见 ADR-4）。隐私说明必须如实写明这一点。

强制执行：

1. 客户端上传前敏感字段检测：字段名匹配（`api_key`/`cookie`/`token`/`secret`/`authorization`）+ 值模式（`sk-`、`tp-`、`eyJ` JWT 前缀、超长 base64）→ 拦截 + 本地错误日志；
2. 服务端：Schema 校验拒未知字段；单事件 ≤4KB、批量 ≤256KB、单批 ≤100 条；
3. 服务端日志：结构化白名单字段输出，禁止 dump 请求体；错误上报只含错误码与标准化消息；
4. **CI 注入测试**：事件含 `api_key`/`cookie`/`token` 字段与值 → 断言客户端拦截与服务端 422，双端各一组用例，CI 必跑；
5. 设备令牌存 Keychain / Credential Manager / libsecret，禁止写入 `~/.okit/*.json`。

## 7. 兼容性测试（定稿前置）

- 为 `SUPPORTED` 中 **37 个用量 provider ID 各准备至少一份真实结构 fixture**（多个 ID 可能共享同一适配器实现——fixture 按 provider ID 覆盖，不按适配器数），全部经过 `canonicalizeUsageEvent()` 后必须通过 Cloud Schema 校验；
- fixture 覆盖特殊形态：平台自定义窗口标签（`custom`）、余额型（`prepaid`）、无窗口（`limit`）、credits 型；
- 新增适配器 PR 必须附带 fixture（CI 强制）。

## 8. 明确不做

- 不上传 Provider 原始响应体（错误上报只传错误码）；
- 不上传浏览器页面内容/DOM 片段；
- 不在云端按用户关联浏览器身份。

## 9. 验收

- [ ] 37 个 provider ID fixture × canonicalize 全绿；
- [ ] Schema 拒绝未知字段的测试用例；
- [ ] CI 双端敏感字段注入测试通过；
- [ ] `(user_id, event_id)` 唯一约束迁移脚本；
- [ ] 金额双轨序列化用例：货币（minor+currency_code）与非货币（decimal string+quantity_unit，含四位小数）无损往返、互斥校验 422；
- [ ] 保留周期与注销删除有代码路径（不止文档）。
