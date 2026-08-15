# 自动创建密钥检测清单

这份清单对应 `AUTO_CREATE_PLATFORMS` 的当前 36 个入口。检测器使用唯一的
`OKIT_AUTOCHECK_*` 名称，调用 OKIT 实际自动创建接口；新建型密钥成功后必须
调用删除接口并确认页面上不再出现该名称。

## 执行

先确保 OKIT Web 服务和 Chrome 扩展已连接，并且各平台已在自动化浏览器中登录：

```bash
node scripts/auto-create-key-check.mjs --dry-run
node scripts/auto-create-key-check.mjs
```

Cloudflare 不会隐式读取生产 Vault Token，需显式提供一次性测试父 Token：

```bash
OKIT_AUTOCHECK_CLOUDFLARE_PARENT_TOKEN='测试用父 Token' \
  node scripts/auto-create-key-check.mjs
```

报告默认保存到 `~/.okit/auto-create-check/`，只包含状态、平台、测试名称和脱敏错误，
不保存任何密钥值。

## 本次真实执行摘要

2026-08-15 的最新全量基线（36 入口）为：16 个 `passed`、19 个 `failed`、1 个
`blocked`，报告为
`~/.okit/auto-create-check/2026-08-14T20-16-10-461Z.json`。随后对 SiliconFlow、
百度千帆和百度 BCE AK/SK 做了定向复测：SiliconFlow 已完成创建、一次性密钥读取、
删除和名称消失确认；千帆已完成创建和一次性密钥读取，但删除确认触发百度短信安全验证，
因此报告为 `cleanup_failed`，不能算通过。

当前全量执行已通过完整创建/删除闭环：OpenAI、Anthropic、智谱 AI、Z.AI、MiniMax
国内与国际站、DeepSeek、Moonshot、阿里云百炼普通与 Coding Plan、小米 MiMo、xAI API、
xAI Management Key、Mistral、OpenRouter、OpenCode Go。
Z.AI 的删除按钮位于固定操作列，MiniMax 的确认按钮有异步渲染；本轮均已通过真实
自动化清理并确认测试名称消失。

用量凭证入口已经补入自动创建：火山 AK/SK、腾讯 SecretId/SecretKey、阿里云
AccessKey、百度 BCE AK/SK。火山入口选择 `AdministratorAccess` 最高全局策略；百度
BCE AK/SK 使用实际入口 `#/iam/accesslist`，只自动勾选精确的主账号风险确认，随后仍
会要求短信安全验证；火山未登录、腾讯要求微信扫码身份验证、阿里 RAM 缺少创建前置
设置。所有确认框和 MFA 都不会被静默绕过，避免无提示创建主账号全量密钥。

本轮最新实测还修复并通过了智谱 AI、Xiaomi MiMo、SiliconFlow 的创建/删除闭环；两者不再沿用早期
“未捕获 key/无创建入口”的旧结论。

Moonshot 的实际控制台要求先提交 `default` 项目，已通过一次性 Secret 读取及精确删除
闭环。Kimi 国内站同样要求 `default` 项目；当前自动化已加入当前弹窗唯一确认目标、真实
前台点击、键盘兜底和唯一名称，但全量实测仍未从一次性结果读取到明文，且页面复核没有
发现 `OKIT_AUTOCHECK_*` 测试行。Cloudflare 因未提供专用测试父 Token 保持 blocked。
千帆当前有三条遗留测试行：
`OKIT_AUTOCHECK_QIANFAN_20260814204707-tf48yp`、
`OKIT_AUTOCHECK_QIANFAN_20260814211050-tfyrdt`、
`OKIT_AUTOCHECK_QIANFAN_20260814211336-tg2bl7`。创建和一次性密钥读取已成功，但
删除流程未命中确认按钮；百度安全验证要求短信验证码。已停止继续创建，需完成验证后
逐条复核删除。报告默认保存在 `~/.okit/auto-create-check/`。

已配置 OKIT 自动化任务：每天 22:00 执行此脚本并写入同一报告目录；任务仍会遵守
Cloudflare 显式父 Token 和 cleanup_failed 停止规则。

## 平台清单

| 状态 | 平台 ID | 入口 | 清理策略 | 结果/备注 |
|---|---|---|---|---|
| [!] | `cloudflare` | Cloudflare | API 删除测试 Token | 缺少显式测试父 Token，blocked |
| [x] | `openai` | OpenAI | 删除测试 Secret Key | passed/deleted |
| [x] | `anthropic` | Anthropic | 删除测试 Key | passed/deleted |
| [!] | `volcengine` | 火山 Ark API Key | 删除测试 Key | 控制台无创建按钮/登录前置 |
| [!] | `volcengine-agent` | 火山 Agent Plan API Key | 删除测试 Key | 控制台无创建按钮/套餐前置 |
| [!] | `volcengine-usage-credentials` | 火山 AK/SK | 删除测试 AK/SK | 未登录；配置最高 `AdministratorAccess` |
| [!] | `tencent` | 腾讯云 API Key | 删除测试 Key | 当前页面无创建入口 |
| [!] | `tencent-token-plan` | 腾讯云 Token Plan | 删除测试 Key | 当前页面无创建入口 |
| [!] | `tencent-usage-credentials` | 腾讯云 SecretId/SecretKey | 删除测试凭证 | 双层主账号风险确认后要求微信扫码身份验证，自动化停止，未创建 |
| [x] | `zhipu` | 智谱 AI | 删除测试 Key | passed/deleted；使用 `/apikey/platform`、列表复制和精确行删除 |
| [x] | `zai-global` | Z.AI | 删除测试 Key | passed/deleted；固定操作列精确删除 |
| [x] | `minimax` | MiniMax 国内 | 删除测试 Key | passed/deleted |
| [!] | `minimax-coding` | MiniMax Token Plan 国内 | 仅验证复制，不删除已有订阅 Key | 无可复制订阅 Key |
| [x] | `minimax-global` | MiniMax 国际 | 删除测试 Key | passed/deleted |
| [!] | `minimax-global-coding` | MiniMax Token Plan 国际 | 仅验证复制，不删除已有订阅 Key | 无可复制订阅 Key |
| [x] | `deepseek` | DeepSeek | 删除测试 Key | passed/deleted |
| [x] | `moonshot` | Moonshot | 删除测试 Key | passed/deleted；提交 `default` 项目并读取一次性 Secret |
| [!] | `moonshot-coding-plan` | Moonshot Coding Plan | 删除测试 Key | 当前页面无创建入口 |
| [!] | `kimi-coding` | Kimi 国内 | 删除测试 Key | 全量实测仍停在创建弹窗，未读取一次性明文；未观察到测试行 |
| [!] | `kimi-coding-plan` | Kimi 国际 | 删除测试 Key | 当前页面无创建入口 |
| [x] | `qwen` | 阿里云百炼 | 删除测试 Key | passed/deleted |
| [x] | `qwen-coding` | 阿里云百炼 Coding Plan | 删除测试 Key | passed/deleted |
| [!] | `qwen-token-plan` | 阿里云百炼 Token Plan | 仅验证复制，不删除已有订阅 Key | 页面无密钥操作入口 |
| [!] | `aliyun-usage-credentials` | 阿里云 AccessKey | 删除测试 AccessKey | RAM 创建前置设置未完成 |
| [x] | `siliconflow` | 硅基流动 | 删除测试 Key | passed/deleted；动态确认码已自动填写并复核名称消失 |
| [!] | `qianfan` | 百度千帆 | 删除测试 Key | 创建/读取已通过；删除确认未命中，当前遗留 3 条测试行，需短信安全验证 |
| [!] | `qianfan-coding` | 百度千帆 Token Plan | 删除测试生成的 Key | 当前页面无密钥操作入口 |
| [!] | `baidu-usage-credentials` | 百度 BCE AK/SK | 删除测试 AK/SK | 实际入口已修正；主账号风险确认后要求短信安全验证 |
| [x] | `xiaomi` | 小米 MiMo | 删除测试 Key | passed/deleted；支持“新建 API Key”和“确认删除”输入 |
| [!] | `xiaomi-coding` | 小米 MiMo Token Plan | 仅验证复制，不删除已有订阅 Key | 已有 key 复制控件未返回明文 |
| [!] | `stepfun` | 阶跃星辰 | 删除测试 Key | 创建后未读到一次性明文；页面无本次测试名 |
| [x] | `xai` | xAI API Key | 删除测试 Key | passed/deleted |
| [x] | `xai-management` | xAI Management Key | 删除测试 Management Key | passed/deleted；Billing 权限设为 Read only |
| [x] | `mistral` | Mistral | 删除/撤销测试 Key | passed/deleted |
| [x] | `openrouter` | OpenRouter | 删除测试 Key | passed/deleted |
| [x] | `opencode-go` | OpenCode Go | 删除测试 Key | passed/deleted |

## 判定规则

- `passed`：创建成功，随后删除成功，并确认测试名称消失。
- `passed_existing_reuse`：平台设计为复用已有订阅 Key，只验证复制/读取，不碰用户已有凭证。
- `failed`：创建未成功；不会执行删除。
- `cleanup_failed`：创建成功但删除未确认；检测器立即停止后续平台，防止产生更多孤儿密钥。
- `blocked`：缺少明确的测试凭证、登录态或平台前置条件。
