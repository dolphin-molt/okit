# OKIT 全平台模型定价与能力对比（截至 2026-08-14）

> 覆盖 OKIT 当前内置的全部 29 个 provider preset（官方 11 / 聚合 2 / 国内 14 / 本地 2，本地 Ollama 与 LiteLLM 不涉及定价）。
> 所有数据来自 2026-08-14 抓取的官方定价页与公开榜单；标注"二手来源"的条目来自聚合站交叉印证，落地使用前请再核对官方页面。
> 价格单位：$ = 美元/百万 token，¥ = 人民币/百万 token，另有注明除外。

---

## 一、国际厂商

### 1. Anthropic（Claude）
来源：https://platform.claude.com/docs/en/about-claude/pricing

| 模型 | 输入 | 输出 | 缓存写(5m) | 缓存写(1h) | 缓存读 | 上下文 | 备注 |
|---|---|---|---|---|---|---|---|
| Claude Fable 5 | $10 | $50 | $12.50 | $20 | $1 | 1M | 新旗舰，Arena 总榜第一 |
| Claude Mythos 5 | $10 | $50 | $12.50 | $20 | $1 | 1M | 限量供应 |
| Claude Opus 5 | $5 | $25 | $6.25 | $10 | $0.50 | 1M | Fast mode $10/$50 |
| Claude Opus 4.5–4.8 | $5 | $25 | $6.25 | $10 | $0.50 | 4.6+ 为 1M | 4.7+ 新 tokenizer，同文本 token 多约 30% |
| Claude Sonnet 5 | $2 | $10 | $2.50 | $4 | $0.20 | — | 促销价已成永久标准价 |
| Claude Sonnet 4.5/4.6 | $3 | $15 | $3.75 | $6 | $0.30 | 4.6 为 1M | |
| Claude Haiku 4.5 | $1 | $5 | $1.25 | $2 | $0.10 | — | |

- Batch API 全线 5 折，可与缓存折扣叠加。缓存倍率：写5m=1.25x、写1h=2x、读=0.1x 输入价。
- Bedrock / Vertex 托管端点：4.5 及以后模型分全球/多区域/区域三类端点，多区域与区域（数据驻留合规）比全球端点 **+10%**；4.1 及更早模型保留原定价。第一方 API 默认全球路由。

#### Claude 云平台渠道深挖（Bedrock / Vertex / Azure Foundry，2026-08）

**三渠道 list price 与第一方完全一致**（Opus 5 $5/$25、Sonnet 5 $2/$10、Haiku 4.5 $1/$5）；云渠道没有更便宜的标价，低价来自可叠加的折扣机制：

| 渠道 | 端点/计费 | 折扣途径 | 备注 |
|---|---|---|---|
| Amazon Bedrock | 全球 profile 最便宜；区域 profile 贵约 10%（即使请求落在同 region 也按 profile 价计） | Batch 5 折；缓存读 0.1x；Provisioned Throughput 按 model unit×小时，1/3/6 个月承诺越深越便宜（费率未公开，联系 AWS）；Bedrock 支出计入 AWS EDP 承诺（折扣率保密） | AWS credits 可用于 Bedrock 原生支出 |
| Google Vertex AI | global 端点=基准价；区域/多区域（us-east5、europe-west1 等）+10% | Batch 5 折；缓存读 0.1x；模型级 CUD 不适用第三方模型，Flexible Savings Plans 是否覆盖 Claude 官方未明确 | Sonnet 5 global 促销价 $2/$10 至 2026-08-31 |
| Claude Platform on AWS（Marketplace） | Anthropic 运营的第一方 API，账单走 AWS Marketplace | list price + 可谈私有报价/承诺折扣；计入 AWS 承诺但 credits 通常不可用 | 新模型 day-one 可用（Bedrock 功能滞后） |
| Azure AI Foundry（已 GA） | Claude Consumption Units：按第一方费率折美元，100 CCU=$1 | 文档确认存在 negotiated discount；MACC 是否适用未公开（第三方 marketplace 项），需个案确认 | Opus 5/4.8/4.7、Sonnet 5/4.6/4.5 |

**最低有效单价（公开可得）**：Opus 5 Batch 输入 $2.50/缓存读 $0.50；Sonnet 5 Batch $1/$5、缓存读 $0.20。大规模平稳流量走 Bedrock Provisioned Throughput（6 个月承诺）或 EDP/MACC 商务折扣可更低，但费率均未公开。

来源：aws.amazon.com/bedrock/pricing · cloud.google.com/vertex-ai/generative-ai/pricing · learn.microsoft.com（CCU billing） · platform.claude.com/docs（Claude Platform on AWS）
- OKIT 对应 preset：`anthropic`（API）+ `anthropic-agent`（Claude Pro/Max 订阅）。

### 2. OpenAI
来源：https://developers.openai.com/api/docs/pricing

| 模型 | 输入 | 输出 | 缓存读 | 长上下文(>272K) | Batch |
|---|---|---|---|---|---|
| gpt-5.6-sol | $5.00 | $30.00 | $0.50 | $10/$45 | 半价 |
| gpt-5.6-terra | $2.00 | $12.00 | $0.20 | $4/$18 | 半价 |
| gpt-5.6-luna | $0.20 | $1.20 | $0.02 | $0.40/$1.80 | 半价 |
| gpt-5.5 / 5.5-pro | $5/$30 | $30/$180 | $0.50/– | – | 半价 |
| gpt-5.4 / mini / nano / pro | $2.50/$0.75/$0.20/$30 | $15/$4.50/$1.25/$180 | $0.25/$0.075/$0.02/– | – | 半价 |
| gpt-5.3-codex | $1.75 | $14.00 | $0.175 | – | – |
| gpt-5.2 / 5.2-pro | $1.75/$21 | $14/$168 | $0.175/– | – | 半价 |
| gpt-5.1 / gpt-5 | $1.25 | $10.00 | $0.125 | – | 半价 |
| gpt-5-mini / nano / pro | $0.25/$0.05/$15 | $2/$0.40/$120 | $0.025/$0.005/– | – | 半价 |
| gpt-5.6-cyber / 5.5-cyber | $12.50 | $75.00 | $1.25 | – | – |
| o1 / o1-pro | $15/$150 | $60/$600 | $7.50/– | – | $7.50/$30 |
| o3 / o3-pro | $2/$20 | $8/$80 | $0.50/– | – | $1/$4 |
| o3-mini / o4-mini | $1.10 | $4.40 | – | – | $0.55/$2.20 |
| gpt-realtime-2.1/2（音频） | $32 | $64 | $0.40 | – | 文本 $4/$24 |
| gpt-4.1 / mini / nano | $2/$0.40/$0.10 | $8/$1.60/$0.40 | – | – | 旧系列 |
| gpt-4o / 4o-mini | $2.50/$0.15 | $10/$0.60 | – | – | 旧系列 |

- Fast mode 约为标准价 2x；Batch/Flex 普遍 5 折；微调已对新用户关闭。
- OKIT 对应 preset：`openai`（API）+ `openai-codex`（ChatGPT 订阅，走 Codex CLI）。

### 3. Google Gemini
来源：https://ai.google.dev/gemini-api/docs/pricing

| 模型 | 输入 | 输出 | 缓存写 | 缓存存储 | 备注 |
|---|---|---|---|---|---|
| Gemini 3.7 Flash | $0.75（2026 促销，2027 起 $1.50） | $3.75（后 $7.50） | $0.075 | $0.50/hr | Batch 半价 |
| Gemini 3.6 Flash | $0.75→$1.50 | $3.75→$7.50 | $0.075 | $0.50/hr | |
| Gemini 3.5 Flash | $1.50 | $9.00 | $0.15 | $1.00/hr | 音频输入另有价 |
| Gemini 3.1 Pro (Preview) | $2.00 | $12.00 | $0.20 | $4.50/hr | 2M 上下文 |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | $0.025 | $1.00/hr | |
| Gemini 3 Flash (Preview) | $0.50 | $3.00 | $0.05 | $1.00/hr | SWE-bench 性价比标杆 |
| Gemini 3 Pro Image (Nano Banana Pro) | $2.00 | 文本 $12 / 图像约 $0.134–0.24 张 | – | – | 图像输入 $0.0011 |
| Gemini 2.5 Pro / Flash / Flash-Lite | $1.25/$0.30/$0.10 | $10/$2.50/$0.40 | $0.125/$0.03/$0.01 | $4.50/$1/$1 per hr | 2.5 Flash 1M 上下文 |

- Batch/Flex 统一 5 折；Priority tier 约 1.8x；grounding 搜索 Gemini 3.x 每月 5,000 次免费。
- OKIT 对应 preset：`google`（API）+ `google-agent`（订阅）。

### 4. xAI（Grok）
来源：https://docs.x.ai/docs/models

| 模型 | 输入(<200K) | 输出(<200K) | 输入(≥200K) | 输出(≥200K) | 缓存读 | 上下文 |
|---|---|---|---|---|---|---|
| grok-4.6 | $2.00 | $6.00 | $4.00 | $12.00 | $0.50 | 500K |
| grok-4.5 | $2.00 | $6.00 | $4.00 | $12.00 | $0.30 | 500K |
| grok-4.3 / 4.20 系列 | $1.25 | $2.50 | $2.50 | $5.00 | $0.20 | 1M |
| grok-build-0.1 | $1.00 | $2.00 | $2.00 | $4.00 | $0.20 | 256K |

- 长上下文计费陷阱：单请求 ≥200K prompt 后，**整个请求**所有 token 按高价档计费。
- 非文本：图像 $0.02–0.05/张；视频 $0.05–0.08/秒；STT $0.10/hr。
- OKIT 对应 preset：`xai` + `xai-grok-build`（Grok/X 订阅）。

### 5. Mistral
来源：https://mistral.ai/pricing/api/

| 模型 | 输入 | 输出 | 缓存读 |
|---|---|---|---|
| Mistral Large 3 | $0.50 | $1.50 | – |
| Mistral Medium 3.5 | $1.50 | $7.50 | – |
| Mistral Small 4 | $0.15 | $0.60 | – |
| Ministral 3 (3B/8B/14B) | $0.10/$0.15/$0.20 | 同输入价 | – |
| Codestral | $0.30 | $0.90 | – |
| Codestral Embed / Mistral Embed | $0.15 / $0.10 | – | – |
| GLM 5.2（托管） | $1.40 | $4.40 | $0.14 |
| Voxtral Small | 文本 $0.10 / 音频 $0.004/min | $0.40 | – |

- 缓存输入约 9 折；Batch 半价；区域推理 +10%。

### 6. GitHub Copilot（订阅制，非按 token 直付）
来源：https://docs.github.com/copilot/reference/copilot-billing/models-and-pricing

| 套餐 | 月费 | AI Credits |
|---|---|---|
| Free | $0 | 有限功能 |
| Pro | $10 | 1,000/月 |
| Pro+ | $39 | 3,900/月 |
| Max | $100 | 10,000/月 |
| Business / Enterprise | $19 / $39 每席 | 池化 |

- 2026-06-01 起迁移到 usage-based：**1 AI Credit = $0.01**，按模型实际 token 消耗折算扣减；代码补全不耗 credits。
- Copilot 内可用模型价格与各官方 API 基本一致（如 Sonnet 5 $2/$10、GPT-5.6 Terra $2/$12、Gemini 3.1 Pro $2/$12、Kimi K2.7 Code $0.95/$4 等）。

---

## 二、国内厂商（¥ 人民币/百万 token）

### 1. DeepSeek
来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing

| 模型 | 输入(命中) | 输入(未命中) | 输出 | 上下文 |
|---|---|---|---|---|
| deepseek-v4-flash | ¥0.02 | ¥1 | ¥2 | 1M（输出最大 384K） |
| deepseek-v4-pro | ¥0.025 | ¥3 | ¥6 | 1M |

- ⚠️ **2026-08-17 起启用峰谷定价**：高峰(9–12/14–18 点) v4-pro 输出 ¥27；空闲时段为高峰一半。
- 国际站 USD：v4-flash $0.0028/$0.14/$0.28；v4-pro $0.0036/$0.435/$0.87。
- 无官方 Coding Plan。

### 2. 智谱 AI / Z.AI
来源：国际站 https://docs.z.ai/guides/overview/pricing（$，官方抓取）；国内站 open.bigmodel.cn/pricing（JS 渲染，人民币价为二手来源）

| 模型 | 输入(Z.AI $) | 缓存 | 输出(Z.AI $) | 国内 ¥（二手） | 上下文 |
|---|---|---|---|---|---|
| GLM-5.2 | $1.4 | $0.26 | $4.4 | ¥8 / ¥28 | 1M |
| GLM-5.1 | $1.4 | $0.26 | $4.4 | – | – |
| GLM-5 | $1.0 | $0.20 | $3.2 | 约 ¥4 / ¥18 | 200K |
| GLM-5-Turbo | $1.2 | $0.24 | $4.0 | – | 200K |
| GLM-4.7 | $0.6 | $0.11 | $2.2 | – | 200K |
| GLM-4.7-Flash | **免费** | – | **免费** | 免费 | 200K |
| GLM-4.7-FlashX | $0.07 | $0.01 | $0.4 | – | – |
| GLM-5V-Turbo（视觉） | $1.2 | $0.24 | $4.0 | – | – |
| GLM-OCR | $0.03 | – | $0.03 | – | 单图≤10MB/PDF≤50MB |

- GLM Coding Plan：Lite ¥118/月（1 万 Credits/周）、Pro ¥538/月、Max ¥1,078/月（含 GLM-5.3/5.2/5-Turbo；价格来自 codingplan.org 二手来源）。
- OKIT 对应 preset：`zai`/`zai-global`（API）+ `glm-coding`/`zai-global-coding`。

### 3. MiniMax
来源：国内 https://platform.minimaxi.com/docs/guides/pricing-paygo（官方抓取）；国际站为二手来源

| 模型 | 输入 | 输出 | 缓存读 | 缓存写 | 备注 |
|---|---|---|---|---|---|
| MiniMax-M3（≤512K） | ¥2.1 | ¥8.4 | ¥0.42 | – | 当前五折价；>512K 档翻倍；priority 层 ×1.5 |
| MiniMax-M2.7 | ¥2.1 | ¥8.4 | ¥0.42 | ¥2.625 | |
| MiniMax-M2.7-highspeed | ¥4.2 | ¥16.8 | ¥0.42 | ¥2.625 | |
| MiniMax-M2.5 / M2.1 / M2 | ¥2.1 / ¥4.2 | ¥8.4 / ¥16.8 | ¥0.21 | ¥2.625 | |
| 国际站 M2.5（二手） | $0.30 | $1.20 | $0.03 | – | highspeed $0.60/$2.40 |

- Token Plan：Plus ¥49/月（6 亿+ token）、Max ¥119/月（18 亿+）、Ultra ¥469/月（71 亿+），含 M3/M2.7/H3/语音。
- OKIT 对应 preset：`minimax`/`minimax-global` + `minimax-coding`/`minimax-global-coding`。

### 4. Moonshot / Kimi
来源：https://platform.kimi.com/docs/pricing/chat-k3（官方抓取）。⚠️ platform.moonshot.cn 已 301 → platform.kimi.com；Moonshot V1 系列 8 月底全平台下线。

| 模型 | 输入(命中) | 输入(未命中) | 输出 | 上下文 |
|---|---|---|---|---|
| Kimi K3（旗舰，约 2.8T 参数） | ¥2 | ¥20 | ¥100 | 1M |
| kimi-k2.7-code | ¥1.3 | ¥6.5 | ¥27 | 256K |
| kimi-k2.7-code-highspeed | ¥2.6 | ¥13 | ¥54 | 256K |
| Kimi K2.6（支持视觉） | ¥1.1 | ¥6.5 | ¥27 | 256K |

- Kimi Coding Plan：Adagio 免费（仅 K2.6）、Andante ¥49/月、Moderato ¥99/月（解锁 K3）、Allegretto ¥199/月、Allegro ¥699/月（K3 解锁 1M 长对话）；5 小时配额制。
- OKIT 对应 preset：`moonshot`、`kimi-coding`、`kimi-coding-plan`。

### 5. 火山引擎豆包（火山方舟）
来源：https://docs.volcengine.com/docs/82379/1544106（部分为搜索摘要交叉印证）

| 模型 | 输入 | 输出 | 缓存 | 上下文 |
|---|---|---|---|---|
| Doubao-Seed-2.0 Pro | ¥3.2 | ¥16 | 约输入 1/10 | 32K 档 |
| 豆包 2.1 Pro | ¥6 | ¥30 | 命中 ¥1.2 | – |
| Doubao-Seed-1.6 | ¥1.2（0–32K） | ¥8（0–32K） | 命中约 ¥1.2 + 存储 ¥0.017/百万/小时 | 256K |
| Doubao-Seed-Code | ¥1.2（0–32K）/ ¥1.4（32–128K） | ¥8 / ¥12 | 约 ¥0.12–0.14 | 256K |

- Coding Plan：Lite ¥40/月（每 5h 约 1200 次请求）、Pro ¥200/月；兼容 Anthropic 协议；新用户赠 50 万 token。
- OKIT 对应 preset：`volcengine`/`volcengine-coding`/`volcengine-agent`。

### 6. 阿里云百炼（Qwen）
来源：https://help.aliyun.com/zh/model-studio/model-pricing

| 模型 | 输入（按长度分档） | 输出 | 缓存 | 上下文 |
|---|---|---|---|---|
| qwen3.8-max | ¥12 | ¥36 | 命中约 ¥1.2 | 1M |
| qwen3-max | ¥2.5/4/7 | ¥10/16/28 | 命中 ¥0.5 | 256K |
| qwen3.7-plus | ¥2/6 | ¥8/24 | – | 1M |
| qwen3.7-flash | ¥0.2/0.6/1.2 | ¥0.8/2.4/4.8 | – | 1M |
| qwen3-coder-plus | ¥4/6/10/20（四档至 1M） | ¥16/24/40/200 | 隐式缓存折扣 | 1M |
| qwen3-coder-flash | ¥1/1.5/2.5/5 | ¥4/6/10/25 | 同上 | 1M |
| qwen3-coder-next | ¥1/1.5/2.5 | ¥4/6/10 | – | 256K |

- Batch 半价；新模型多含 100 万 token 免费额度（90 天）。百炼同时托管 deepseek-v4、glm-5.2、kimi-k3、MiniMax-M3、MiMo 等第三方模型。
- Coding Plan 打包 Qwen3.5/GLM-5/MiniMax M2.5/Kimi K2.5。OKIT preset：`qwen`/`qwen-coding`。

### 7. 百度千帆
来源：https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya

| 模型 | 输入 | 输出 | 缓存 | 上下文 |
|---|---|---|---|---|
| ERNIE 5.1 | ¥4（≤32K）/ ¥6 | ¥18 / ¥22 | ¥0.2 | 128K |
| ERNIE 5.0 系列 | ¥6 / ¥10 | ¥24 / ¥40 | – | 128K |
| ERNIE 4.5 Turbo | ¥0.8（Batch ¥0.32） | ¥3.2（Batch ¥1.28） | ¥0.2 | 32K/128K |
| ERNIE X1.1 | ¥1 | ¥4 | – | – |

- Token Plan（首购 5 折）：Mini ¥4.9/月（1000 万 token）→ Max ¥299.9/月（7 亿）；已支持 ERNIE-5.1、GLM-5.2。OKIT preset：`qianfan`/`qianfan-coding`。

### 8. 腾讯云混元
来源：https://cloud.tencent.com/document/product/1729/97731

| 模型 | 输入 | 输出 | 缓存 | 上下文 |
|---|---|---|---|---|
| Hunyuan Hy3（旗舰，已开源） | ¥1 | ¥4 | ¥0.25 | 256K |
| hunyuan-t1 | ¥1 | ¥4 | – | 256K |
| Hunyuan-a13b（开源） | ¥0.5 | ¥2 | – | – |
| Hunyuan-turbos-vision | ¥3 | ¥9 | – | – |
| 混元 Lite | **免费** | **免费** | – | – |

- TokenHub 聚合 18 款模型（混元/DeepSeek/GLM/Kimi/MiniMax），一个 Key 兼容 OpenAI + Anthropic 协议（Claude Code 可直连）；Token Plan 个人版 ¥28/月起（3500 万 token）。

### 9. 阶跃星辰 StepFun
来源：https://platform.stepfun.com/docs/zh/guides/pricing/details

| 模型 | 输入(未命中/命中) | 输出 |
|---|---|---|
| step-3.7-flash | ¥1.35 / ¥0.27 | ¥8.1 |
| step-3.5-flash（含 -2603） | ¥0.7 / ¥0.14 | ¥2.1 |

- Step Plan 订阅：四档起步 ¥49/月（社区限时半价 ¥25）。

### 10. 小米 MiMo
来源：https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go（2026-05-27 起永久降价，不分上下文档）

| 模型 | 输入(命中) | 输入(未命中) | 输出 | 备注 |
|---|---|---|---|---|
| mimo-v2.5-pro | ¥0.025 | ¥3 | ¥6 | 海外 $0.0036/$0.435/$0.87 |
| mimo-v2.5 | ¥0.02 | ¥1 | ¥2 | 1M 上下文；海外 $0.0028/$0.14/$0.28 |

- 缓存写入限时免费；MiMo-V2 已于 2026-06-30 下线。
- 按量 vs Token Plan：按量走普通 Key 消耗余额；Token Plan 走 `tp-` 开头 Key + 专属 base_url（cn/sgp 集群不同域），额度独立。Token Plan：Lite ¥39/月（约 6000 万 token）、Standard ¥99/月（约 2 亿）。

### 11. 硅基流动 SiliconFlow
来源：https://siliconflow.cn/pricing

| 模型 | 输入 | 输出 | 缓存命中 |
|---|---|---|---|
| DeepSeek-V4-Pro | ¥12 | ¥24 | ¥1 |
| DeepSeek-V4-Flash | ¥1 | ¥2 | ¥0.02 |
| DeepSeek-V3.2 | ¥4 | ¥6 | ¥0.4 |
| Qwen3.5-397B-A17B | ¥1.2(<128K)/¥3 | ¥7.2/¥18 | – |
| GLM-5.2 | ¥8 | ¥28 | ¥2 |
| Kimi-K2.7-Code | ¥6.5 | ¥27 | ¥1.3 |
| MiniMax-M2.5 | ¥2.1 | ¥8.4 | ¥0.21 |
| Step-3.5-Flash | ¥0.7 | ¥2.1 | – |
| Hunyuan-A13B | ¥0.8（日间 ¥1.0） | ¥3.2（日间 ¥4.0） | 夜间折扣 |
| GLM-Z1-9B / bge-m3 / Kolors 等 | 免费 | 免费 | – |

- 无订阅套餐；Batch 75 折 + 大量免费小模型。

---

## 三、聚合平台

### OpenRouter
- **单价与官方 pass-through 直通、无加价**；收入来自充值手续费 5.5%（最低 $0.80，消费 $200 后降至 5%）。
- 变体后缀：`:nitro` 最快吞吐、`:floor` 最便宜、`:exacto` 精度优先——只改变供应商路由，不改变单价。
- 热门模型价基本等于官方价（Opus 5 $5/$25、GPT-5.2 Codex $1.75/$14、Gemini 3 Flash $0.50/$3 等）；同一模型不同供应商间价差可达数倍。
- OKIT preset：`openrouter`。

### OpenCode
- **Zen**：充值制按量付费（最低 $20，卡费约 4.4%+$0.30 转嫁），零加价，可设月度上限。
- **Go**：$10/月订阅（首月 $5），提供热门开源编码模型额度（含 7 款中国模型）。
- OKIT preset：`opencode-go`。

---

## 四、模型能力对比（截至 2026-08）

> 分数来自 artificialanalysis.ai、swebench.com、tbench.ai、arena.ai（原 LMArena，2026-07-12 重置 Elo 基线）、vals.ai 等；不同 harness/推理档位下分数差异大，自报口径分数置信度低。

| 模型 | 上下文 | 模态 | 推理 | SWE-bench Verified | 其他关键分数 | 价格档 |
|---|---|---|---|---|---|---|
| Claude Opus 5 | 250K（编码 1M） | 视觉+工具 | 有 | vals.ai 榜 97.0%（自报，存疑） | AA 指数 63.0（#1） | $5/$25 |
| Claude Fable 5 | ~250K+ | 视觉+工具 | 有 | 第三方 93.9–95% | Arena 总榜 #1（~1525 Elo）；AA 62.1 | $10/$50 |
| Claude Opus 4.7 | 200K | 视觉+工具 | 有 | 87.6% | GPQA Diamond 94.2% | $5/$25 |
| GPT-5.3-Codex | 128K–400K | 视觉+音频+工具 | 有 | – | **Terminal-Bench 2.0: 77.3%**；SWE-bench Pro 56.8% | $1.75/$14 |
| GPT-5.2 Codex | 同上 | 同上 | 有 | 官方 72.8% / 第三方 ~80% | Terminal-Bench 2.0: 66.5% | $1.75/$14 |
| GPT-5.5/5.6 | 128K+ | 视觉+音频+工具 | 有(xhigh) | LM Council 80.6%±1.8 | AA: 5.6 Sol 58.9 | $5/$30 |
| Gemini 3.1 Pro | 2M | 视觉+音频+工具 | 有 | 80.6%（第三方） | LiveCodeBench Pro Elo 2439 | $2/$12 |
| Gemini 3 Flash | 1M | 视觉+音频+工具 | 有 | **75.80%**（$0.36/实例） | LiveCodeBench 96.2% | $0.50/$3 |
| Grok 4.5/4.6 | 500K | 视觉+工具 | 可调 effort | 非编程榜首 | AA: 4.6 = 60.9（#3） | $2/$6 |
| DeepSeek V4-Pro | 1M | 文本+工具 | 有 | 与 Opus 4.7 互有胜负 | "最便宜的 Opus 级" | ¥3/¥6（≈$0.42/$0.84） |
| GLM-5 / 5.2 | 200K–1M | 文本+工具(部分视觉) | 有 | GLM-5: 72.80%（$0.53/实例） | SWE-bench Pro: GLM-5.2 62.1%（开源第一） | $1/$3.2 起 |
| Kimi K3 / K2.6 | K2.6: 2M | K2.6 含视觉 | K2 Thinking 推理型 | SWE-rebench: K2 Thinking 43.8%（开源第一） | AA: K3 = 59.7（#4） | ¥20/¥100 |
| MiniMax M2.5 / M3 | ~200K | 文本+工具 | 有 | **M2.5: 75.80%（$0.07/实例，成本最低）** | SWE-bench Pro: M3 59.0%；Terminal-Bench 42.2% | ¥2.1/¥8.4 |
| Qwen3-Coder 系列 | 1M | 文本+工具 | 有 | SWE-rebench 25–31% 区间 | – | ¥4/¥16 起 |
| Doubao Seed 2.0 Pro | 256K 档 | 文本+工具 | 有 | 76.5%（Evolink 口径） | 多语言 Multi-SWE-bench | ¥3.2/¥16 |
| MiMo-V2.5 | 1M | 文本+工具 | 有 | 未上榜 | AA 指数 ~34 | ¥1/¥2 |

### 关键结论

1. **综合智能**（Artificial Analysis 指数）：Claude Opus 5 (63.0) > Claude Fable 5 (62.1) > Grok 4.6 (60.9) > Kimi K3 (59.7) > GPT-5.6 Sol (58.9)。
2. **聊天竞技场**：Arena 总榜 Claude Fable 5 第一（~1525 Elo，注意 2026-07 基线重置）。
3. **编程**（swebench.com 官方 harness）：Gemini 3 Flash 与 MiniMax M2.5 并列 75.80%，但 M2.5 每实例成本仅 $0.07；GLM-5 与 GPT-5.2 均 72.80%。
4. **终端/Agent**：Terminal-Bench 2.0 上 GPT-5.3-Codex (77.3%) 明显领先。
5. **性价比三强**：MiniMax M2.5、Gemini 3 Flash（$0.5/$3）、DeepSeek V4（国际站 ~$0.42/$0.84）；Grok 4.5 以 $2/$6 搅动旗舰价格战。
6. **长上下文**：Gemini 3.1 Pro（2M）、Kimi K2.6（2M）、DeepSeek V4 / Qwen3-Coder（1M）。

---

## 五、订阅制（Coding/Token/Agent Plan）与 API 按量的区别

| 维度 | API 按量 | 订阅制 |
|---|---|---|
| 计费 | 输入/输出/缓存分开计价，用多少付多少 | 固定月费换额度（credits / 每N小时请求数 / token 包） |
| 单价 | 名义高，但 Batch 5 折、缓存读 0.1x 可大幅压成本 | 折算单价通常仅为 API 的 1–2 折（如火山 Coding Plan 约 1 折） |
| 可用客户端 | 任意协议兼容客户端 | 多数限官方/指定 CLI（Claude Code、Codex CLI、Copilot 插件） |
| 适用 | 构建产品、多用户、波动用量 | 个人重度编码 agent 场景几乎总是更划算 |

国内订阅速览（月费）：百度 Mini ¥4.9（首购）→ 阶跃 ¥49 / MiniMax ¥49 / Kimi ¥49 → 混元 TokenHub ¥28 → 火山 ¥40 → 智谱 ¥118 → 小米 ¥39/99；国际：Copilot $10–100、OpenCode Go $10。

---

## 六、与 OKIT 的映射及注意事项

- OKIT preset 覆盖以上全部厂商；Coding/Token Plan 类 preset（`*-coding`/`*-agent`）走各厂商订阅专属端点（Anthropic 协议居多），与按量 API Key/端点互不通用（小米 `tp-` 前缀 Key 即典型）。
- **近期重要变更需关注**：DeepSeek 8-17 峰谷定价（高峰输出 ¥27）；Moonshot V1 八月底下线且平台已迁移至 platform.kimi.com；MiMo V2 已下线（V2.5 cn/sgp 集群不同 base_url）；MiniMax coding_plan 端点已变更为 token_plan（此前已在 OKIT 修复）；智谱 GLM-5 系列国内外均有调价。
- 定价数据时效性：本表为 2026-08-14 快照，促销价（Gemini 3.6/3.7 Flash、Sonnet 5、MiniMax M3 五折、千帆首购 5 折）到期后会变化。
