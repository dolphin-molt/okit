# ADR-5：AgentProfile 配置档案、备份与新设备恢复

> 状态：Draft r1（2026-08-15；配合商业化方案 v2.1 §6B "Secure Environment" 第二支柱）。
> 定位：Phase 1B。**独立于 ADR-4（Vault 密码学）**——本文档不定义密钥派生/加密协议，只定义 Agent 配置的档案模型与恢复机制；加密复用 ADR-4 的 DEK 体系。
> 前置依赖：Phase 1A（Vault 多设备同步）先落地——恢复流程需要"解锁 Vault"。

## 1. 决策

- **密钥与 Agent 配置采用不同同步策略**：Vault 密钥是结构化数据 → 自动多设备同步（ADR-4）；Agent 配置 → **配置档案备份 + 用户主动恢复**，第一版不做实时双向同步、不自动合并；
- 两层架构：OKIT 维护标准化的逻辑 **AgentProfile**（第一层，用户想要的 Agent 环境）；各 Agent 本机配置文件（第二层）由 **Adapter** 按 Agent 版本与操作系统生成；
- AgentProfile 属敏感配置，用 ADR-4 的 DEK 加密后上传，**服务端不可读取内容**；
- 一切恢复/覆盖由**用户主动触发**，永不后台静默覆盖本机或云端。

## 2. 数据模型（AgentProfile）

```json
{
  "schema_version": 1,
  "profile_id": "uuid",
  "profile_name": "我的 AI 开发环境",
  "profile_revision": 6,
  "agents": {
    "codex": {
      "enabled": true,
      "default_provider_account_id": "provider-account-uuid",
      "default_model_id": "openai/gpt-5",
      "models": [
        {
          "id": "openai/gpt-5",
          "provider_account_id": "provider-account-uuid",
          "model": "gpt-5"
        }
      ],
      "settings": {}
    },
    "claude-code": {
      "enabled": true,
      "default_provider_account_id": "anthropic-account-uuid",
      "default_model_id": "anthropic/claude-opus",
      "models": [],
      "settings": {}
    }
  }
}
```

规则：

- **密钥绝不写入 AgentProfile**，只保存 Vault 引用，且**只认稳定 UUID**——名称/别名会因重命名或目录调整失效：

```json
{ "vault_item_id": "vault-item-uuid", "display_alias": "Anthropic Main" }
```

  真正的关联只走 `vault_item_id`（ADR-4 同步条目的稳定 item UUID）；`display_alias` 仅用于界面展示，改名不断链。**禁止** `vault://anthropic/main` 这类名称路径式引用；
- `provider_account_id` 与 Cloud Monitor 的稳定 Provider 账号身份（ADR-1 §5）同源，跨设备语义一致；
- **`profile_revision` 由服务端 CAS 分配**（复用 ADR-4 版本顺序规则）：客户端提交 `base_profile_revision`，服务端 CAS 成功后分配新 `profile_revision`；即使第一版不做实时同步，两台设备也可能先后手动"更新云端档案"——基于同一版本的并发提交，恰一 201、其余 409；
- `schema_version` 独立于 `profile_revision`，迁移用（模型字段演进不等于内容变更）；云端保留历史版本（默认 10 个）供回滚。

## 3. 一个 Agent 对应多个配置文件：逻辑档案 + Adapter 投射

云端**只保存一份逻辑 AgentProfile**，即使本机默认模型与模型列表位于不同文件：

```text
云端：AgentProfile.codex { default_model_id, models[] }
恢复时：
AgentProfile
      ↓
Codex Adapter
      ├── 写默认模型配置文件
      └── 写模型列表配置文件
```

云端不同步原始文件；Adapter 负责把同一份逻辑配置**投射**到本机对应的多个文件。

## 4. Adapter 接口

```ts
interface AgentProfileAdapter {
  detect(): AgentEnvironment;      // Agent 是否安装、版本、配置文件位置
  capture(): AgentProfile;         // 从一个或多个本机配置文件提取 OKIT 支持的字段
  plan(profile: AgentProfile): ApplyPlan;   // 恢复预览：将修改哪些文件/字段
  apply(plan: ApplyPlan): ApplyResult;      // 备份原文件后应用；失败回滚
}
```

约束：

- **只修改 OKIT 管理的字段**，必须保留用户其他未知配置（未知字段不读不写不删）；
- `apply` 前**必须备份原文件**（本地备份 + 一键回滚）；
- 任一文件写入失败 → 完整回滚（不留半应用状态）；
- `plan` 生成的预览必须展示文件级与字段级变更清单。

## 5. 新设备恢复流程

```text
用户登录相同 OKIT 账号
        ↓
解锁 Vault（ADR-4 主密码/恢复密钥）
        ↓
下载并解密 AgentProfile
        ↓
detect()：识别本机已安装的 Agent 和版本
        ↓
plan()：显示恢复预览
        ↓
用户点击"恢复到此设备"
        ↓
apply()：Adapter 备份并生成本机配置
```

恢复界面示例：

```text
准备恢复以下环境：

✓ Codex
  默认模型：GPT-5
  Provider：OpenAI Main
  模型列表：4 个

✓ Claude Code
  默认模型：Claude Opus
  Provider：Anthropic Main

! Gemini CLI
  当前设备尚未安装，暂不应用

[恢复到此设备]
```

外部变更检测：用户在 Agent 外部修改配置后，OKIT 检测差异并**提示**——"检测到 Codex 配置发生变化，是否更新云端配置档案？"**没有用户确认，不自动覆盖云端版本或其他设备。**

## 6. 第一版明确不做

- 浏览器 Cookie、Session；
- OAuth 登录状态；
- 对话历史；
- 日志和缓存；
- 项目绝对路径（只存逻辑项目标识，同 ADR-4）；
- Agent 可执行文件的本机路径；
- 整个 `~/.claude`、`~/.codex` 等目录；
- Agent 配置的实时自动双向同步；
- 字段级自动冲突合并。

（后两项待付费验证充分后再考虑，见主方案 §12 路线图"后续"。）

## 7. 定稿前置（升 Accepted 前必须完成）

AgentProfile 能否安全保留未知字段，纸面推演不算数，必须用真实 Agent 配置验证：

- [ ] **多文件 Agent POC**：一个"默认模型与模型列表分属不同文件"的 Agent，`capture()` 产出完整档案、`apply()` 正确写回两个文件；
- [ ] **多格式 POC**：一个 JSON 配置 + 一个 TOML/YAML 配置的 Agent 各一套（序列化器保字段/保注释能力差异必须实测）；
- [ ] **全链路演练**：`capture → plan → apply → rollback` 完整跑通（含失败注入回滚）；
- [ ] **未知字段保护**：修改 OKIT 已知字段后，未知字段与**注释**（TOML/YAML）零丢失；
- [ ] **版本兼容**：新旧 Agent 配置版本（升级/降级）的 capture/apply 兼容测试；
- [ ] 至少覆盖**两个真实 Agent**（建议 codex + claude-code）。

## 8. 验收标准

1. 当前设备默认模型和模型列表位于不同文件时，`capture()` 能生成一份完整 AgentProfile；
2. 新设备恢复后，Adapter 正确生成对应的多个配置文件；
3. 默认模型不存在于模型列表时**阻止应用**并提示；
4. 新设备未安装对应 Agent 时跳过（`!` 标记），不产生错误配置；
5. 应用前有差异预览和本地备份；
6. 任一文件写入失败时可完整回滚；
7. 未知字段和用户自定义配置不被覆盖；
8. AgentProfile 不包含 API Key、Cookie、Token 等明文（CI 注入测试，同 ADR-1 §6 手法）；
9. Vault 中缺少对应 `vault_item_id` 时提示用户补充，不写入无效配置；
10. 配置恢复默认由用户主动触发，不在后台静默覆盖（无任何自动 apply 路径）。

## 9. 与其他 ADR 的边界

| 主题 | 归属 |
|---|---|
| DEK 派生、加密格式、AAD、revision/CAS | ADR-4（本文档复用，不重定义） |
| Provider 账号稳定身份 | ADR-1 §5 |
| 设备注册/吊销/解绑不删云端数据 | ADR-2 §3 |
| AgentProfile 档案模型与恢复机制 | **本文档** |
