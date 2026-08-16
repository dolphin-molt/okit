# 火山引擎 AK/SK 用量查询配置

## 结论

OKIT 不自动创建火山引擎传统 AK/SK。请在火山引擎 IAM 中创建用户、绑定权限、创建 AK/SK，再手动录入 OKIT。

这里的 AK/SK 是火山引擎云账号的管理凭证，不是火山方舟 API Key：

- 方舟 API Key：用于调用模型接口。
- 火山引擎 AK/SK：用于调用 IAM 权限范围内的管理/用量接口。

火山引擎的权限绑定在主账号或 IAM 用户上，Access Key 继承所属身份的权限，不能在创建 Access Key 的弹窗里单独设置。每个账号/IAM 用户最多同时拥有两个 Access Key，建议使用 IAM 用户并把第二把 Key 留作轮转。

## 需要的权限

按需要给 IAM 用户绑定以下策略：

| 用途 | 权限 |
|---|---|
| 查询方舟 Coding Plan / Agent Plan 用量 | 方舟只读权限；当前 OKIT 按 `ArkReadOnlyAccess` 提示 |
| 查询费用中心余额 | `BillingCenterReadOnlyAccess` |
| 同时查询套餐用量和余额 | 同时绑定以上两项 |

不需要为了查询用量给 OKIT 创建主账号 Access Key，也不建议直接使用主账号密钥。

## 创建步骤

1. 登录火山引擎控制台，进入访问控制/IAM。
2. 创建一个专用 IAM 用户，例如 `okit-usage`。不要为每个用量卡创建一个新的主账号 Access Key。
3. 在该 IAM 用户的权限设置中绑定所需只读策略。
4. 在该 IAM 用户的“密钥”页面创建或查看 Access Key ID 和 Secret Access Key。
5. 在 OKIT 的“密钥管理”中选择“手动录入”。
6. 推荐使用以下名称和 JSON 值：

   名称：`VOLCENGINE_BILLING_CREDENTIALS`

   ```json
   {
     "accessKey": "你的 Access Key ID",
     "secretKey": "你的 Secret Access Key"
   }
   ```

7. 选择“火山引擎”分组，点击“加密保存”。

也可以拆成两条密钥：

- `VOLCENGINE_ACCESS_KEY`
- `VOLCENGINE_SECRET_KEY`

## 验证结果

保存后刷新用量统计：

- Coding Plan / Agent Plan 卡片请求的是火山方舟控制面用量接口，不使用方舟 API Key。
- 余额卡片请求费用中心余额接口。
- 如果返回 `403`，通常是 IAM 用户缺少对应只读权限。
- 如果返回未授权、AccessKey 无效或签名错误，检查 AK/SK 是否复制完整，以及密钥是否已被禁用或删除。
- 如果凭证有效但账号没有对应套餐，卡片会显示未开通或没有额度。

## 删除或禁用后的行为

OKIT 目前没有火山引擎平台同步机制。你在火山引擎控制台删除或禁用 AK/SK 后，OKIT 本地仍会保留加密副本；下一次查询时才会通过接口错误发现凭证失效。此时请在 OKIT 中删除旧条目，再录入新的 AK/SK。

## 官方文档

- [火山引擎权限策略简介](https://www.volcengine.com/docs/6257/65058?lang=zh)
- [API 访问密钥（Access Key）](https://www.volcengine.com/docs/6291/216573?lang=zh)
- [火山引擎 AK/SK 与 IAM 用户](https://www.volcengine.com/docs/6469/1166573?lang=zh)
- [费用中心权限管理](https://www.volcengine.com/docs/6269/1186807?lang=zh)
- [火山方舟 GetAFPUsage API](https://api.volcengine.com/api-explorer/?action=GetAFPUsage&groupName=Agent+Plan+API&serviceCode=ark&version=2024-01-01)
