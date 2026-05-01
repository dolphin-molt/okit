const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { backupImportantData } = require('./backup');

const CONFIG_PATH = path.join(os.homedir(), '.okit', 'user.json');
const PROVIDERS_PATH = path.join(os.homedir(), '.okit', 'providers.json');
const LOGS_DIR = path.join(os.homedir(), '.okit', 'logs');
const HISTORY_FILE = path.join(LOGS_DIR, 'history.jsonl');

const SECRET_FIELD_PATTERNS = /ecret|oken|Key|Id$/;
const SKIP_FIELDS = /databaseId|bucketName|region/i;
const VAULT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{2,}$/;
const PLATFORM_SECRET_FIELDS = {
  cloudflare: ['apiToken', 'storeId'],
  'cloudflare-d1': ['apiToken'],
  'cloudflare-kv': ['apiToken'],
  'cloudflare-r2': ['accountId', 'r2AccessKeyId', 'r2SecretAccessKey'],
  volcengine: ['accessKey', 'secretKey'],
  supabase: ['projectId', 'apiKey', 'apiToken'],
};
const SYNC_CODE_PREFIX = 'okit-sync:';
const SYNC_CODE_SALT = 'okit-sync-code-salt';

async function loadConfig() {
  try {
    if (!(await fs.pathExists(CONFIG_PATH))) return {};
    return await fs.readJson(CONFIG_PATH);
  } catch { return {}; }
}

async function saveConfig(config) {
  await fs.ensureDir(path.dirname(CONFIG_PATH));
  await backupImportantData('sync');
  await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
}

async function loadProvidersConfig() {
  try {
    if (!(await fs.pathExists(PROVIDERS_PATH))) return [];
    const raw = await fs.readFile(PROVIDERS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.providers) ? data.providers : [];
  } catch {
    return [];
  }
}

async function saveProvidersConfig(providers) {
  if (!Array.isArray(providers)) return;
  await fs.ensureDir(path.dirname(PROVIDERS_PATH));
  await backupImportantData('providers-sync');
  await fs.writeFile(PROVIDERS_PATH, JSON.stringify({ providers, version: 1 }, null, 2));
}

async function mergeProvidersConfig(remoteProviders) {
  if (!Array.isArray(remoteProviders)) return 0;
  const localProviders = await loadProvidersConfig();
  const merged = [...localProviders];
  let changed = 0;
  for (const remote of remoteProviders) {
    if (!remote?.id) continue;
    const idx = merged.findIndex(provider => provider.id === remote.id);
    if (idx >= 0) merged[idx] = { ...merged[idx], ...remote };
    else merged.push(remote);
    changed++;
  }
  if (changed > 0) await saveProvidersConfig(merged);
  return changed;
}

function appendLog(action, name, success, detail) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const entry = { timestamp: new Date().toISOString(), name, action, success, duration: 0 };
    if (detail) entry.output = detail;
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n');
  } catch {}
}

function parseKeyAlias(input) {
  const slashIdx = input.indexOf('/');
  if (slashIdx === -1) return { key: input, alias: 'default' };
  return { key: input.slice(0, slashIdx), alias: input.slice(slashIdx + 1) };
}

function deriveSyncCodeKey(password) {
  return crypto.pbkdf2Sync(password, SYNC_CODE_SALT, 100000, 32, 'sha256');
}

function encryptSyncCodePayload(payload, password) {
  const key = deriveSyncCodeKey(password);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SYNC_CODE_PREFIX}${Buffer.from(JSON.stringify({
    v: 1,
    nonce: iv.toString('hex'),
    ciphertext: encrypted.toString('hex'),
    tag: tag.toString('hex'),
  })).toString('base64url')}`;
}

function decryptSyncCodePayload(code, password) {
  const raw = String(code || '').trim();
  if (!raw.startsWith(SYNC_CODE_PREFIX)) throw new Error('同步码格式不正确');
  const encoded = raw.slice(SYNC_CODE_PREFIX.length);
  let blob;
  try {
    blob = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('同步码格式不正确');
  }
  const key = deriveSyncCodeKey(password);
  const iv = Buffer.from(blob.nonce, 'hex');
  const tag = Buffer.from(blob.tag, 'hex');
  const ciphertext = Buffer.from(blob.ciphertext, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    throw new Error('同步密码不正确，无法解密同步码');
  }
}

function isVaultRefField(platform, key, value) {
  const allowedFields = platform ? PLATFORM_SECRET_FIELDS[platform] : null;
  if (allowedFields && !allowedFields.includes(key)) return false;
  return typeof value === 'string' && SECRET_FIELD_PATTERNS.test(key) && !SKIP_FIELDS.test(key) && VAULT_KEY_PATTERN.test(value);
}

function keyAliasFor(secret) {
  return secret.alias && secret.alias !== 'default' ? `${secret.key}/${secret.alias}` : secret.key;
}

async function collectPlatformVaultSecrets(platConfig, platform) {
  const refs = [];
  for (const [field, value] of Object.entries(platConfig || {})) {
    if (!isVaultRefField(platform, field, value)) continue;
    const parsed = parseKeyAlias(value);
    refs.push({ field, value, ...parsed });
  }
  if (refs.length === 0) return [];

  const { VaultStore } = require('../../vault/store');
  const store = new VaultStore();
  const allSecrets = await store.exportAll();
  const selected = [];
  const missing = [];
  for (const ref of refs) {
    let secret = allSecrets.find(s => s.key === ref.key && (s.alias || 'default') === ref.alias);
    if (!secret && ref.alias === 'default') secret = allSecrets.find(s => s.key === ref.key);
    if (!secret) {
      missing.push(ref.value);
      continue;
    }
    selected.push(secret);
  }
  if (missing.length > 0) throw new Error(`配置引用的密钥不存在：${missing.join(', ')}`);

  const seen = new Set();
  return selected
    .filter(secret => {
      const id = `${secret.key}/${secret.alias || 'default'}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(secret => ({
      key: secret.key,
      alias: secret.alias || 'default',
      value: secret.value,
      group: secret.group || '',
      expiresAt: secret.expiresAt || '',
      updatedAt: secret.updatedAt,
    }));
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
      const parsed = parseKeyAlias(value);
      let actual = await store.get(value);
      if (!actual && typeof store.resolve === 'function') actual = await store.resolve(parsed.key, parsed.alias);
      if (!actual && typeof store.getAliases === 'function') {
        const aliases = await store.getAliases(parsed.key);
        if (aliases.length > 0) actual = await store.get(`${parsed.key}/${aliases[0]}`);
      }
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
    settings: { agent: config.agent || {}, providers: await loadProvidersConfig() },
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
  const providers = await mergeProvidersConfig(remoteData.settings?.providers);
  if (!config.sync.machineId) config.sync.machineId = crypto.randomUUID();
  config.sync.lastSyncAt = new Date().toISOString();
  config.sync.lastSyncPlatform = entry.id;
  await saveConfig(config);

  appendLog('sync-pull', entry.id, true, `+${added} ~${updated} providers:${providers}`);
  return { added, updated, providers, total: (remoteData.secrets || []).length };
}

async function exportSyncCode(passwordOverride) {
  const config = await loadConfig();
  const password = passwordOverride || config.sync?.password;
  if (!password) throw new Error('请先设置同步密码');

  const platforms = config.sync?.platforms || {};
  const target = config.sync?.syncPlatform;
  const entry = target && platforms[target]?.enabled ? { id: target, config: platforms[target] } : null;
  if (!entry) throw new Error('请先启用一个同步平台');

  const platformSecrets = await collectPlatformVaultSecrets(entry.config, entry.id);
  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    syncPlatform: entry.id,
    platformConfig: entry.config,
    platformSecrets,
  };

  return {
    code: encryptSyncCodePayload(payload, password),
    platform: entry.id,
    secrets: platformSecrets.length,
  };
}

async function importSyncCode(code, password) {
  if (!password) throw new Error('请先设置同步密码');
  const payload = decryptSyncCodePayload(code, password);
  if (!payload?.syncPlatform || !payload?.platformConfig) throw new Error('同步码缺少平台配置');

  const { VaultStore } = require('../../vault/store');
  const store = new VaultStore();
  const secrets = Array.isArray(payload.platformSecrets) ? payload.platformSecrets : [];
  for (const secret of secrets) {
    if (!secret?.key || typeof secret.value !== 'string') continue;
    await store.set(keyAliasFor(secret), secret.value, secret.group || '', secret.expiresAt || undefined);
  }

  const config = await loadConfig();
  config.sync = {
    ...(config.sync || {}),
    password,
    syncPlatform: payload.syncPlatform,
    platforms: {
      ...(config.sync?.platforms || {}),
      [payload.syncPlatform]: {
        ...payload.platformConfig,
        enabled: true,
      },
    },
  };
  await saveConfig(config);
  appendLog('sync-code-import', payload.syncPlatform, true, `${secrets.length} secrets`);

  return { platform: payload.syncPlatform, secrets: secrets.length };
}

module.exports = { loadConfig, saveConfig, resolveVaultRefs, testConnection, pushSecrets, syncPush, syncPull, exportSyncCode, importSyncCode };
