# ADR-4：Phase 1 零知识同步密码学设计

> 状态：Draft r2（2026-08-15 第四轮评审修订 + 第五轮收口；配合商业化方案 v2.1 §6）。
> **Phase 1 开工前本文档需单独通过一次密码学安全评审后升 Accepted**；Cloud Monitor（Phase 0）不依赖本文档。

## 1. 决策

- 认证与加密彻底分离：账号登录方式与 Vault 主密码互不派生；
- 服务端**永远接触不到**：主密码、任何可重放的主密码派生值、明文密钥数据；
- KEK 只存在于客户端内存；DEK 随机生成、永不出客户端明文形态；
- **版本号（revision）由服务端原子分配**，客户端不自行生成全局版本；冲突判定只依赖服务端 revision，不信任客户端 `updated_at`。

## 2. 密钥层次

```text
路径 A（主密码，用户可记忆 → 低熵 → 需要慢哈希）：
Vault 主密码（永不上传）
   │ Argon2id（m=64MiB, t=3, p=1 起步；参数随密文存储、可升级；
   │           必须在最低支持硬件上实测，且在 worker 线程运行，不阻塞 UI）
   ▼
KEK_password（内存中，会话结束即弃）

路径 B（恢复密钥，随机 256-bit → 高熵 → 不需要 Argon2id）：
恢复密钥（随机 256-bit）
   │ HKDF-SHA256（salt=用户盐，info="okit-recovery-v1" 做用途分离）
   ▼
KEK_recovery

两条路径分别解包同一份：
随机 256-bit DEK --AES-256-GCM--> Vault 条目密文
```

云端每用户存储——服务端**无法解密 Vault 内容**；但设备列表、记录数量、时间与大小等**同步元数据对服务端可见，属于敏感元数据**（隐私说明必须如实披露）：

| 字段 | 说明 |
|---|---|
| `kdf_params` | 算法/盐/难度（明文，升级 KDF 需重新包装） |
| `wrapped_dek.password` | KEK_password 路径包装的 DEK |
| `wrapped_dek.recovery` | KEK_recovery 路径包装的 DEK |
| `enc_format_version` | 加密格式版本（迁移用） |

**恢复密钥编码（统一为一种）**：分组 Base32（RFC 4648，无小写歧义、手抄友好）+ 末尾校验字符（模 32 校验位），形如 `AB2C-D4EF-...-XK`。全文档禁再出现 Base64 表述。

## 3. 明确否决项

| 否决 | 理由 |
|---|---|
| 登录密码 = 主密码 | 服务端重置登录即可能触碰加密；弱密码同时是账号与加密双弱点 |
| 主密码 hash（哪怕加盐）上传服务端做"验证" | 等价于可离线爆破的凭据副本；验证只能在客户端做（试解包 GCM tag） |
| 恢复密钥再走 Argon2id | 256-bit 随机数已是高熵，慢哈希无收益徒增延迟；HKDF 足矣 |
| DEK 直接由主密码派生（无随机 DEK 层） | 换密码需重加密全部数据；分层后换密码只重新包装 |
| 服务端可解的"托管备份" | 违背零知识承诺；客服永远不能解密 |

## 4. AEAD 细节（AES-256-GCM）

- **Nonce**：每次加密生成全新随机 12-byte nonce（客户端 CSPRNG），与密文一同存储；**任何情况下不得复用**（同一 DEK 下 nonce 重用直接摧毁 GCM 机密性，NIST SP 800-38D 硬性要求）；
- **AAD 必须绑定记录身份**，防止合法密文被跨记录/跨字段替换。**AAD 不包含 `server_revision`**——客户端加密时服务端尚未分配 revision（revision 要收到密文后经 CAS 才产生，放进 AAD 会形成"加密需要 revision、revision 需要密文"的循环依赖）。绑定客户端生成的**变更标识 `mutation_id`**（UUID v4，每次内容变更新生成，重试复用同一值）：

```text
AAD = canonical_json({
  owner_id, item_id, record_type, key_version,
  mutation_id, schema_version, deleted
})
```

  `mutation_id` 同时作为客户端侧内容版本标识：同一 mutation 重试 → 同 AAD 同密文，天然幂等；解密时 AAD 不匹配 → 拒绝该记录并标记冲突。`server_revision` 只是服务端 CAS 顺序号（§5），与密文内容解耦。

## 5. 条目级同步协议（服务端权威版本）

- 服务端为每个 `item_id` 维护 head revision；条目不可变追加（append-only 版本链），旧版本保留 N=90 天供回滚；
- **写入流程（原子 CAS）**：

```text
客户端 POST { item_id, base_revision, mutation_id, ciphertext, nonce, aad_meta, device_id,
             envelope_hash = SHA-256(ciphertext ‖ nonce ‖ canonical AAD) }
服务端（唯一约束 owner_id + item_id + mutation_id）：
  已存在同 mutation_id：
    envelope_hash 相同 → 200 幂等重放，返回原 server_revision
    envelope_hash 不同 → 409 idempotency_conflict（同 ID 不同内容，拒绝并告警）
  不存在：
    if base_revision == head_revision[item_id]
      → 原子分配 server_revision = head + 1，落库，返回 201 { server_revision }
    else → 409 { head_revision }（客户端拉取 head，走冲突解决 UI）
```

- 客户端提交的版本**永远只是 `base_revision`**（乐观并发基准）；最终顺序号 `server_revision` 由服务端在 CAS 成功后分配，并发设备不可能产生相同 revision，也不可能用旧版本覆盖新版本；`server_revision` 不进 AAD、不参与密文（§4）；
- `mutation_id` 三重职责：AAD 内容绑定 + 服务端重放幂等键 + envelope 一致性校验锚点。**客户端重试必须复用完整原始 envelope**（同一 ciphertext/nonce/AAD/密文，不得以同一 `mutation_id` 重新加密产生新 nonce/密文后重发——新内容必须换新 `mutation_id`）；
- 冲突判定只依赖服务端 revision 序列；客户端 `updated_at` 仅作展示，不参与判定；
- 删除 = 墓碑记录（同样走 CAS，`deleted=true` 进 AAD）：墓碑密文进入**加密回收站**，默认保留 **30 天**，期间用户可恢复（恢复 = 以新 revision 重新提交内容，非物理回滚）；过期后延迟清理；
- **过期设备不能复活已删除密钥**：墓碑成为 head 后，`base_revision` 落后的任何设备提交都收到 409（CAS 天然保证，无需额外机制）；
- 设备退出/解绑 ≠ 删除数据（仅吊销访问权，ADR-2）；"从所有设备删除"才产生墓碑；
- 设备相关数据（项目绝对路径等）不同步，仅同步逻辑标识，每设备重建映射。

## 6. 迁移（现有明文 master.key → 新格式，单机可完成）

现状利好：`~/.okit/vault/master.key` 明文 hex（`src/vault/store.ts:43`）。**不在本地保留原始 master.key 30 天**（r2 修订：明文密钥长期滞留是最大风险面），改为：

1. 读明文 key → 解密现有 Vault；
2. 用户设置新主密码 → Argon2id 派生 KEK_password；生成恢复密钥展示（一次性）；
3. 生成随机 DEK_v2，逐条目（非大 blob）重加密（每条独立 nonce + AAD）；
4. 上传 `kdf_params` + 双路径 wrapped DEK + 条目密文（`enc_format_version=2`）；
5. **当前设备**从云端重新下载，在独立临时目录解密并逐条比对（计数 + 每条 hash）；
6. 制作**回滚包**：旧格式数据用新 DEK（或恢复密钥）加密后存本地一份（替代"保留明文 master.key"的回滚手段）；
7. 校验通过 → 原子切换新格式，**立即删除原始 `master.key`**（r2：不再有 30 天明文滞留）；
8. 第二台设备/定期恢复演练为可选，不是迁移门槛；失败可回滚（步骤 6 的加密回滚包）。

⚠️ 实施前审计既有代码：`cloud-sync-core.js` 的同步密码派生与本地存储、`updatedAt` 合并对删除/冲突的处理。

## 7. 密码学选型

| 用途 | 选型 | 备注 |
|---|---|---|
| 主密码 KDF | Argon2id | RFC 9106；参数版本化随密文存储；最低支持硬件实测 + worker 线程 |
| 恢复密钥派生 | HKDF-SHA256 | 高熵输入做用途分离（info 域隔离） |
| 对称加密 | AES-256-GCM | 12-byte 随机 nonce + §4 AAD；AEAD tag 兼做"密码验证" |
| 随机源 | OS CSPRNG | 恢复密钥 256-bit 分组 Base32 + 校验位 |
| 传输 | TLS 1.3 | 应用层不再叠加（密文本身非秘密） |

## 8. 验收

- [ ] 服务端数据全部为密文/非秘密字段的审计（人工 + 自动扫描）；
- [ ] **AAD 绑定测试**：把条目 A 的密文塞进条目 B 的 item_id → 解密失败（AAD 不匹配）；同 mutation_id + 同 envelope_hash 重放 → 幂等 200 返回原 revision；同 mutation_id + 不同 envelope_hash → 409 idempotency_conflict；
- [ ] **nonce 唯一性测试**：同一 DEK 下全部 nonce 无重复（扫描迁移输出与随机生成器）；
- [ ] **并发 CAS 测试**：两设备同 base_revision 并发提交 → 恰一 201 一 409，head 连续无跳号；
- [ ] **AAD 无循环依赖确认**：客户端离线（未联系服务端）即可完成加密——AAD 只含客户端可知字段（含 mutation_id），不含 server_revision；
- [ ] 忘记主密码 + 恢复密钥 → 成功重设；无恢复密钥 → 旧数据确认不可恢复；
- [ ] 换主密码只重包装 DEK，不重加密全部条目；
- [ ] 迁移步骤 5 独立上下文解密校验自动化（内容计数 + hash 比对）；
- [ ] 迁移后原始 `master.key` 确认删除，回滚包可用恢复。
