const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CONFIG_PATH = path.join(os.homedir(), '.okit', 'user.json');
const LOGS_DIR = path.join(os.homedir(), '.okit', 'logs');
const HISTORY_FILE = path.join(LOGS_DIR, 'history.jsonl');

const SECRET_FIELD_PATTERNS = /ecret|oken|Key|Id$/;
const SKIP_FIELDS = /storeId|databaseId|bucketName|region/i;
const VAULT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{2,}$/;
const PLATFORM_SECRET_FIELDS = {
  cloudflare: ['apiToken'],
  'cloudflare-d1': ['apiToken'],
  'cloudflare-kv': ['apiToken'],
  'cloudflare-r2': ['r2AccessKeyId', 'r2SecretAccessKey'],
  volcengine: ['accessKey', 'secretKey'],
  supabase: ['projectId', 'apiKey'],
};

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

function appendLog(action, name, success, detail) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const entry = { timestamp: new Date().toISOString(), name, action, success, duration: 0 };
    if (detail) entry.output = detail;
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n');
  } catch {}
}

async function resolveVaultRefs(platConfig, platform) {
  const { VaultStore } = require('../../vault/store');
  const store = new VaultStore();
  const resolved = { ...platConfig };
  const allowedFields = platform ? PLATFORM_SECRET_FIELDS[platform] : null;
  for (const [key, value] of Object.entries(resolved)) {
    if (allowedFields && !allowedFields.includes(key)) continue;
    if (typeof value === 'string' && SECRET_FIELD_PATTERNS.test(key) && !SKIP_FIELDS.test(key)) {
      if (!VAULT_KEY_PATTERN.test(value)) continue;
      const parsed = VaultStore.parseKeyAlias(value);
      let actual = await store.get(value);
      if (!actual) actual = await store.resolve(parsed.key, parsed.alias);
      if (!actual) throw new Error(`密钥 "${value}" 不存在，请先在密钥管理中添加`);
      resolved[key] = actual;
    }
  }
  return resolved;
}

async function testConnection(platform) {
  const config = await loadConfig();
  const platConfig = config.sync?.platforms?.[platform];
  if (!platConfig) throw new Error(`平台 ${platform} 未配置`);

  const resolved = await resolveVaultRefs(platConfig, platform);
  const adapter = require(`./platform-adapters/${platform}`);
  const result = await adapter.testConnection(resolved);
  appendLog('platform-test', platform, true, result);
  return result;
}

async function pushSecrets(platform, keys) {
  const config = await loadConfig();
  const platConfig = config.sync?.platforms?.[platform];
  if (!platConfig?.enabled) throw new Error(`平台 ${platform} 未启用`);

  const { VaultStore } = require('../../vault/store');
  const store = new VaultStore();
  const allSecrets = await store.exportAll();

  const keySet = keys ? new Set(keys) : null;
  const grouped = {};
  for (const s of allSecrets) {
    if (keySet && !keySet.has(s.key)) continue;
    if (!grouped[s.key]) grouped[s.key] = { key: s.key, group: s.group || '', aliases: [] };
    grouped[s.key].aliases.push({ alias: s.alias || 'default', value: s.value, updatedAt: s.updatedAt });
  }
  const secrets = Object.values(grouped);

  const resolved = await resolveVaultRefs(platConfig, platform);
  const adapter = require(`./platform-adapters/${platform}`);
  const results = await adapter.syncSecrets(resolved, secrets);
  appendLog('cloud-push', platform, true, `${secrets.length} secrets`);
  return results;
}

async function syncPush() {
  const config = await loadConfig();
  const password = config.sync?.password;
  if (!password) throw new Error('请先设置同步密码');

  const platforms = config.sync?.platforms || {};
  const target = config.sync?.syncPlatform;
  const entry = target && platforms[target]?.enabled ? { id: target, config: platforms[target] } : null;
  if (!entry) throw new Error('请先启用一个同步平台');

  const resolvedConfig = await resolveVaultRefs(entry.config, entry.id);

  const key = crypto.pbkdf2Sync(password, 'okit-sync-salt', 100000, 32, 'sha256');
  const userId = key.slice(0, 16).toString('hex');
  const encryptionKey = key;

  if (!config.sync.machineId) {
    config.sync.machineId = crypto.randomUUID();
  }

  const { VaultStore } = require('../../vault/store');
  const store = new VaultStore();
  const secrets = await store.exportAll();

  const syncData = {
    secrets,
    settings: { agent: config.agent || {} },
    updatedAt: new Date().toISOString(),
    machineId: config.sync.machineId,
  };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(syncData), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encryptedBlob = { nonce: iv.toString('hex'), ciphertext: encrypted.toString('hex'), tag: tag.toString('hex') };

  const adapter = require(`./platform-adapters/${entry.id}`);
  await adapter.pushSync(resolvedConfig, userId, encryptedBlob);

  config.sync.lastSyncAt = new Date().toISOString();
  config.sync.lastSyncPlatform = entry.id;
  await saveConfig(config);

  appendLog('sync-push', entry.id, true, `${secrets.length} secrets`);
  return { secrets: secrets.length, platform: adapter.name };
}

async function syncPull() {
  const config = await loadConfig();
  const password = config.sync?.password;
  if (!password) throw new Error('请先设置同步密码');

  const platforms = config.sync?.platforms || {};
  const target = config.sync?.syncPlatform;
  const entry = target && platforms[target]?.enabled ? { id: target, config: platforms[target] } : null;
  if (!entry) throw new Error('请先启用一个同步平台');

  const key = crypto.pbkdf2Sync(password, 'okit-sync-salt', 100000, 32, 'sha256');
  const userId = key.slice(0, 16).toString('hex');
  const encryptionKey = key;

  const resolvedConfig = await resolveVaultRefs(entry.config, entry.id);
  const adapter = require(`./platform-adapters/${entry.id}`);
  const encrypted = await adapter.pullSync(resolvedConfig, userId);
  if (!encrypted) throw new Error('远端没有同步数据');

  const iv = Buffer.from(encrypted.nonce, 'hex');
  const tag = Buffer.from(encrypted.tag, 'hex');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const remoteData = JSON.parse(decrypted.toString('utf8'));

  // Merge
  const { VaultStore } = require('../../vault/store');
  const store = new VaultStore();
  const localSecrets = await store.exportAll();
  const localMap = new Map();
  for (const s of localSecrets) localMap.set(s.key + '/' + (s.alias || 'default'), s);

  let added = 0, updated = 0;
  for (const remote of (remoteData.secrets || [])) {
    const mapKey = remote.key + '/' + (remote.alias || 'default');
    const local = localMap.get(mapKey);
    if (!local) {
      const keyAlias = remote.alias && remote.alias !== 'default' ? `${remote.key}/${remote.alias}` : remote.key;
      await store.set(keyAlias, remote.value, remote.group, remote.expiresAt);
      added++;
    } else if (remote.updatedAt && (!local.updatedAt || remote.updatedAt > local.updatedAt)) {
      const keyAlias = remote.alias && remote.alias !== 'default' ? `${remote.key}/${remote.alias}` : remote.key;
      await store.set(keyAlias, remote.value, remote.group, remote.expiresAt);
      updated++;
    }
  }

  if (remoteData.settings?.agent) {
    config.agent = { ...(config.agent || {}), ...remoteData.settings.agent };
  }
  if (!config.sync.machineId) config.sync.machineId = crypto.randomUUID();
  config.sync.lastSyncAt = new Date().toISOString();
  config.sync.lastSyncPlatform = entry.id;
  await saveConfig(config);

  appendLog('sync-pull', entry.id, true, `+${added} ~${updated}`);
  return { added, updated, total: (remoteData.secrets || []).length };
}

module.exports = { loadConfig, saveConfig, resolveVaultRefs, testConnection, pushSecrets, syncPush, syncPull };
