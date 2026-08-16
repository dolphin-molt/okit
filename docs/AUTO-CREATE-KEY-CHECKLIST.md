# 自动创建密钥检测清单

这份清单对应 `AUTO_CREATE_PLATFORMS` 的当前 32 个入口。检测器使用唯一的
`OKIT_AUTOCHECK_*` 名称，调用 OKIT 实际自动创建接口；新建型密钥成功后必须
调用删除接口并确认页面上不再出现该名称。

## 执行

先确保 OKIT Web 服务和 Chrome 扩展已连接，并且各平台已在自动化浏览器中登录：

```bash
node scripts/auto-create-key-check.mjs --dry-run
node scripts/auto-create-key-check.mjs
```

如果上一轮报告留下 `cleanup_failed` 或等待人工验证的测试密钥，先用原报告做清理续跑，
不会重新创建新的 Key：

```bash
node scripts/auto-create-key-check.mjs --cleanup ~/.okit/auto-create-check/<report>.json
```

Cloudflare 不会隐式读取生产 Vault Token，需显式提供一次性测试父 Token：

```bash
OKIT_AUTOCHECK_CLOUDFLARE_PARENT_TOKEN='测试用父 Token' \
  node scripts/auto-create-key-check.mjs
```

报告默认保存到 `~/.okit/auto-create-check/`，只包含状态、平台、测试名称和脱敏错误，
不保存任何密钥值。

## 本次真实执行摘要

历史全量报告只作为历史记录，不能当作当前通过率。当前验收按以下状态处理：

- `passed`：本轮创建唯一测试 Key，读取一次性明文，删除同一个 Key，并确认平台页面不再有该名称。
- `passed_existing_reuse`：平台只允许复用现有订阅/Token Plan Key；只验证复制和读取，不创建、不删除用户 Key。
- `waiting_for_user`：验证码、短信、微信扫码、MFA 或登录需要用户完成；任务暂停，不重试、不重复创建。
- `blocked_prerequisite`：缺少专用测试凭证、套餐、权限、创建前置或当前页面没有密钥操作入口。
- `failed`：排除上述情况后的自动化/平台实现问题，需要修复后复测。
- `cleanup_failed`：已创建但删除未确认；立即停止后续创建，先清理孤儿。

当前已确认的定向证据：

- DeepSeek：报告 `2026-08-15T03-36-03-302Z.json` 为 `passed`，真实完成创建、读取、删除和名称消失确认。
- 腾讯云 Token Plan：报告 `2026-08-15T03-36-24-578Z.json` 为 `passed_existing_reuse`，没有创建或删除用户 Key。
- MiniMax 国内 Token Plan：当前停在官方安全验证，记为 `waiting_for_user`；产品名称统一使用 Token Plan，不再写 Coding Plan。
- MiniMax 国际、百度千帆 Token Plan、小米 MiMo Token Plan：已验证现有 Key 复用路径为 `passed_existing_reuse`。
- 阿里云百炼 Token Plan 当前没有可复用的密钥操作入口，记为 `blocked_prerequisite`，不会生成新 Key。
- 国内 Kimi API 与 Kimi Coding Plan 统一归入 `Kimi` 分组；国际 API 平台归入 `Moonshot`。各类 Key 仍然不互换。

腾讯 SecretId/SecretKey、百度 BCE AK/SK、阿里云 AccessKey 与火山传统 AK/SK
均已改为手动配置，不再出现在自动创建列表。原因是它们属于账号级 IAM/RAM/CAM 身份凭证，
权限绑定在 IAM 用户/主账号上，且 OKIT 没有平台端删除同步。请按
[火山引擎 AK/SK 用量查询配置](volcengine-usage-credentials.md)操作。

百度千帆当前仍有三条遗留测试行：
`OKIT_AUTOCHECK_QIANFAN_20260814204707-tf48yp`、
`OKIT_AUTOCHECK_QIANFAN_20260814211050-tfyrdt`、
`OKIT_AUTOCHECK_QIANFAN_20260814211336-tg2bl7`。创建和一次性密钥读取曾经成功，
删除时触发短信安全验证；在短信验证完成并逐条确认页面名称消失前，不能称为全量完成，
也不能继续批量创建千帆测试 Key。

已配置 OKIT 自动化任务：每天 22:00 执行固定 checkout
`/Users/dolphin/.codex/worktrees/ece3/okit`，运行前校验路径、分支和干净状态；不满足时只
写入 `blocked_prerequisite`，不执行第三方创建。报告默认保存在 `~/.okit/auto-create-check/`。

## 平台清单

| 状态 | 平台 ID | 入口 | 清理策略 | 结果/备注 |
|---|---|---|---|---|
| [!] | `cloudflare` | Cloudflare | API 删除测试 Token | 缺少显式测试父 Token，blocked |
| [x] | `openai` | OpenAI | 删除测试 Secret Key | passed/deleted |
| [x] | `anthropic` | Anthropic | 删除测试 Key | passed/deleted |
| [!] | `volcengine` | 火山 Ark API Key | 删除测试 Key | 控制台无创建按钮/登录前置 |
| [!] | `volcengine-agent` | 火山 Agent Plan API Key | 删除测试 Key | 控制台无创建按钮/套餐前置 |
| [!] | `tencent` | 腾讯云 API Key | 删除测试 Key | 当前页面无创建入口 |
| [x] | `tencent-token-plan` | 腾讯云 Token Plan | 仅验证复制，不删除已有订阅 Key | passed_existing_reuse |
| [—] | `tencent-usage-credentials` | 腾讯云 SecretId/SecretKey | 手动配置 | 账号级 CAM 凭证，不提供自动创建；用量页展示名称、JSON 格式和控制台入口 |
| [x] | `zhipu` | 智谱 AI | 删除测试 Key | passed/deleted；使用 `/apikey/platform`、列表复制和精确行删除 |
| [x] | `zai-global` | Z.AI | 删除测试 Key | passed/deleted；固定操作列精确删除 |
| [x] | `minimax` | MiniMax 国内 | 删除测试 Key | passed/deleted |
| [!] | `minimax-coding` | MiniMax Token Plan 国内 | 仅验证复制，不删除已有订阅 Key | waiting_for_user：官方安全验证 |
| [x] | `minimax-global` | MiniMax 国际 | 删除测试 Key | passed/deleted |
| [!] | `minimax-global-coding` | MiniMax Token Plan 国际 | 仅验证复制，不删除已有订阅 Key | 无可复制订阅 Key |
| [x] | `deepseek` | DeepSeek | 删除测试 Key | passed/deleted |
| [x] | `moonshot` | Moonshot | 删除测试 Key | passed/deleted；提交 `default` 项目并读取一次性 Secret |
| [!] | `moonshot-coding-plan` | Moonshot Coding Plan | 仅验证复制，不创建/删除订阅 Key | 当前 Code 页面无密钥操作入口，blocked_prerequisite |
| [!] | `kimi-coding` | Kimi | 删除测试 Key | 全量实测仍停在创建弹窗，未读取一次性明文；未观察到测试行 |
| [!] | `kimi-coding-plan` | Kimi | 创建 API Key 后读取一次性明文 | Coding Plan 仅属于国内 Kimi；控制台最多 5 个 Key，创建后仅显示一次 |
| [x] | `qwen` | 阿里云百炼 | 删除测试 Key | passed/deleted |
| [x] | `qwen-coding` | 阿里云百炼 Coding Plan | 删除测试 Key | passed/deleted |
| [!] | `qwen-token-plan` | 阿里云百炼 Token Plan | 仅验证复制，不创建/删除订阅 Key | 没有可复用的密钥操作入口，blocked_prerequisite |
| [x] | `siliconflow` | 硅基流动 | 删除测试 Key | passed/deleted；动态确认码已自动填写并复核名称消失 |
| [!] | `qianfan` | 百度千帆 | 删除测试 Key | 创建/读取已通过；删除确认未命中，当前遗留 3 条测试行，需短信安全验证 |
| [!] | `qianfan-coding` | 百度千帆 Token Plan | 删除测试生成的 Key | 当前页面无密钥操作入口 |
| [—] | `baidu-usage-credentials` | 百度 BCE AK/SK | 手动配置 | 账号级 IAM 凭证，不提供自动创建；用量页展示名称、JSON 格式和控制台入口 |
| [x] | `xiaomi` | 小米 MiMo | 删除测试 Key | passed/deleted；支持“新建 API Key”和“确认删除”输入 |
| [x] | `xiaomi-coding` | 小米 MiMo Token Plan | 仅验证复制，不删除已有订阅 Key | passed_existing_reuse |
| [!] | `stepfun` | 阶跃星辰 | 删除测试 Key | 创建后未读到一次性明文；页面无本次测试名 |
| [x] | `xai` | xAI API Key | 删除测试 Key | passed/deleted |
| [x] | `xai-management` | xAI Management Key | 删除测试 Management Key | passed/deleted；Billing 权限设为 Read only |
| [x] | `mistral` | Mistral | 删除/撤销测试 Key | passed/deleted |
| [x] | `openrouter` | OpenRouter | 删除测试 Key | passed/deleted |
| [!] | `openrouter-management` | OpenRouter Management Key（用量） | 登录后创建/读取/删除测试 Key | 已接入独立余额凭证；当前应用内浏览器未登录，待端到端验证；该 Key 无账务只读权限范围 |
| [x] | `opencode-go` | OpenCode Go | 删除测试 Key | passed/deleted |

## 判定规则

- `passed`：创建成功，随后删除成功，并确认测试名称消失。
- `passed_existing_reuse`：平台设计为复用已有订阅 Key，只验证复制/读取，不碰用户已有凭证。
- `failed`：排除等待人工和前置阻塞后的创建/读取/删除实现问题；修复后必须复测。
- `cleanup_failed`：创建成功但删除未确认；检测器立即停止后续平台，防止产生更多孤儿密钥。
- `waiting_for_user`：需要验证码、登录、短信/微信/MFA；等待用户完成，不绕过、不重复创建。
- `blocked_prerequisite`：缺少明确的测试凭证、套餐、权限、创建前置或密钥操作入口。
