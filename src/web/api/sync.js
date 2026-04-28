const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.okit', 'user.json');
const LOGS_DIR = path.join(os.homedir(), '.okit', 'logs');
const HISTORY_FILE = path.join(LOGS_DIR, 'history.jsonl');

function appendLog(action, name, success, detail) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const entry = { timestamp: new Date().toISOString(), name, action, success, duration: 0 };
    if (detail) entry.output = detail;
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n');
  } catch {}
}

// ─── Key Derivation ───
function deriveSyncKeys(password) {
  const key = crypto.pbkdf2Sync(password, 'okit-sync-salt', 100000, 32, 'sha256');
  return {
    userId: key.slice(0, 16).toString('hex'),
    encryptionKey: key,
  };
}

// ─── AES-256-GCM Encrypt/Decrypt ───
function encryptBlob(data, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { nonce: iv.toString('hex'), ciphertext: encrypted.toString('hex'), tag: tag.toString('hex') };
}

function decryptBlob(blob, key) {
  const iv = Buffer.from(blob.nonce, 'hex');
  const tag = Buffer.from(blob.tag, 'hex');
  const ciphertext = Buffer.from(blob.ciphertext, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

// ─── Config Helpers ───
async function loadConfig() {
  try {
    if (!(await fs.pathExists(CONFIG_PATH))) return {};
    return await fs.readJson(CONFIG_PATH);
  } catch { return {}; }
}

async function saveConfig(config) {
  await fs.ensureDir(path.dirname(CONFIG_PATH));
  await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
}

function ensureMachineId(config) {
  if (!config.sync) config.sync = { autoSync: false, platforms: {} };
  if (!config.sync.machineId) {
    config.sync.machineId = crypto.randomUUID();
  }
  return config.sync.machineId;
}

function getEnabledPlatform(config) {
  const platforms = config.sync?.platforms || {};
  const target = config.sync?.syncPlatform;
  if (target && platforms[target]?.enabled) return { id: target, config: platforms[target] };
  return null;
}

async function resolveVaultRefs(platConfig) {
  const { VaultStore } = require('../../vault/store');
  const store = new VaultStore();
  const SECRET_FIELD_PATTERNS = /ecret|oken|Key|Id$/;
  const SKIP_FIELDS = /storeId|databaseId|bucketName|region/i;
  const VAULT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{2,}$/;
  const resolved = { ...platConfig };
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'string' && SECRET_FIELD_PATTERNS.test(key) && !SKIP_FIELDS.test(key)) {
      if (!VAULT_KEY_PATTERN.test(value)) continue;
      let actual = await store.get(value);
      if (!actual) {
        const aliases = await store.getAliases(value);
        if (aliases.length > 0) actual = await store.get(value + '/' + aliases[0]);
      }
      if (!actual) throw new Error(`密钥 "${value}" 不存在，请先在密钥管理中添加`);
      resolved[key] = actual;
    }
  }
  return resolved;
}

// ─── Merge Logic ───
function mergeSecrets(localSecrets, remoteSecrets) {
  const localMap = new Map();
  for (const s of localSecrets) {
    localMap.set(s.key + '/' + (s.alias || 'default'), s);
  }

  let added = 0;
  let updated = 0;
  const merged = [...localSecrets];

  for (const remote of remoteSecrets) {
    const mapKey = remote.key + '/' + (remote.alias || 'default');
    const local = localMap.get(mapKey);
    if (!local) {
      merged.push(remote);
      added++;
    } else if (remote.updatedAt && (!local.updatedAt || remote.updatedAt > local.updatedAt)) {
      const idx = merged.findIndex(s => s.key === remote.key && (s.alias || 'default') === (remote.alias || 'default'));
      if (idx >= 0) merged[idx] = remote;
      updated++;
    }
  }

  return { secrets: merged, added, updated };
}

// ─── Handlers ───
async function handlePush(req, res) {
  try {
    const config = await loadConfig();
    const password = config.sync?.password;
    if (!password) return res.status(400).json({ error: '请先设置同步密码' });

    const platform = getEnabledPlatform(config);
    if (!platform) return res.status(400).json({ error: '请先启用一个同步平台' });

    const resolvedConfig = await resolveVaultRefs(platform.config);

    const { userId, encryptionKey } = deriveSyncKeys(password);
    const machineId = ensureMachineId(config);

    // Collect vault secrets
    const { VaultStore } = require('../../vault/store');
    const store = new VaultStore();
    const secrets = await store.exportAll();

    // Collect agent settings
    const agentSettings = config.agent || {};

    const syncData = {
      secrets,
      settings: { agent: agentSettings },
      updatedAt: new Date().toISOString(),
      machineId,
    };

    const encrypted = encryptBlob(syncData, encryptionKey);

    // Push to platform
    const adapter = require(`./platform-adapters/${platform.id}`);
    await adapter.pushSync(resolvedConfig, userId, encrypted);

    // Update sync metadata
    config.sync.lastSyncAt = new Date().toISOString();
    config.sync.lastSyncPlatform = platform.id;
    await saveConfig(config);

    appendLog('sync-push', platform.id, true, `${secrets.length} secrets`);
    res.json({ success: true, message: `已推送 ${secrets.length} 个密钥`, secrets: secrets.length, platform: adapter.name });
  } catch (error) {
    console.error('Sync push error:', error);
    appendLog('sync-push', 'sync', false, error.message);
    res.status(500).json({ error: error.message || '推送失败' });
  }
}

async function handlePull(req, res) {
  try {
    const config = await loadConfig();
    const password = config.sync?.password;
    if (!password) return res.status(400).json({ error: '请先设置同步密码' });

    const platform = getEnabledPlatform(config);
    if (!platform) return res.status(400).json({ error: '请先启用一个同步平台' });

    const { userId, encryptionKey } = deriveSyncKeys(password);

    const resolvedConfig = await resolveVaultRefs(platform.config);

    // Pull from platform
    const adapter = require(`./platform-adapters/${platform.id}`);
    const encrypted = await adapter.pullSync(resolvedConfig, userId);
    if (!encrypted) return res.status(404).json({ error: '远端没有同步数据' });

    const remoteData = decryptBlob(encrypted, encryptionKey);

    // Merge secrets
    const { VaultStore } = require('../../vault/store');
    const store = new VaultStore();
    const localSecrets = await store.exportAll();
    const { secrets: merged, added, updated } = mergeSecrets(localSecrets, remoteData.secrets || []);

    // Write merged secrets
    for (const s of merged) {
      const keyAlias = s.alias && s.alias !== 'default' ? `${s.key}/${s.alias}` : s.key;
      const local = localSecrets.find(l => l.key === s.key && (l.alias || 'default') === (s.alias || 'default'));
      if (!local) {
        await store.set(keyAlias, s.value, s.group, s.expiresAt);
      } else if (s.updatedAt && (!local.updatedAt || s.updatedAt > local.updatedAt)) {
        await store.set(keyAlias, s.value, s.group, s.expiresAt);
      }
    }

    // Merge agent settings (remote wins if newer)
    if (remoteData.settings?.agent) {
      config.agent = { ...(config.agent || {}), ...remoteData.settings.agent };
      await saveConfig(config);
    }

    // Update sync metadata
    config.sync.lastSyncAt = new Date().toISOString();
    config.sync.lastSyncPlatform = platform.id;
    ensureMachineId(config);
    await saveConfig(config);

    appendLog('sync-pull', platform.id, true, `+${added} ~${updated}`);
    res.json({
      success: true,
      message: `拉取完成：新增 ${added} 个，更新 ${updated} 个`,
      added,
      updated,
      total: merged.length,
      remoteMachine: remoteData.machineId,
    });
  } catch (error) {
    console.error('Sync pull error:', error);
    if (error.message?.includes('Unsupported state') || error.message?.includes('AUTHENTICATION_FAILED')) {
      appendLog('sync-pull', 'sync', false, '密码错误或数据损坏');
      return res.status(400).json({ error: '同步密码不正确，无法解密远端数据' });
    }
    appendLog('sync-pull', 'sync', false, error.message);
    res.status(500).json({ error: error.message || '拉取失败' });
  }
}

async function handleStatus(req, res) {
  try {
    const config = await loadConfig();
    const sync = config.sync || {};
    const platform = getEnabledPlatform(config);

    res.json({
      machineId: sync.machineId || null,
      lastSyncAt: sync.lastSyncAt || null,
      platformId: platform ? platform.id : null,
      hasPassword: !!sync.password,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get sync status' });
  }
}

module.exports = { handlePush, handlePull, handleStatus };
