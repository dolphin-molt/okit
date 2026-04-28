const fetch = require('node-fetch');

const API_BASE = 'https://api.cloudflare.com/client/v4';
const DB_NAME = 'okit-sync';

async function cfFetch(token, path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!data.success) {
    const errors = (data.errors || []).map(e => e.message).join('; ');
    throw new Error(errors || `Cloudflare API error: ${res.status}`);
  }
  return data;
}

async function listAccounts(token) {
  const data = await cfFetch(token, '/accounts');
  return data.result || [];
}

async function ensureDatabase(token, accountId) {
  // List existing databases
  const data = await cfFetch(token, `/accounts/${accountId}/d1/database`);
  const dbs = data.result || [];
  const existing = dbs.find(db => db.name === DB_NAME);
  if (existing) return existing.uuid;

  // Create database
  const created = await cfFetch(token, `/accounts/${accountId}/d1/database`, {
    method: 'POST',
    body: JSON.stringify({ name: DB_NAME }),
  });
  return created.result.uuid;
}

async function ensureTable(token, accountId, databaseId, tableName) {
  try {
    await cfFetch(token,
      `/accounts/${accountId}/d1/database/${databaseId}/query`,
      { method: 'POST', body: JSON.stringify({ sql: `SELECT 1 FROM ${tableName} LIMIT 1` }) });
  } catch {
    await cfFetch(token,
      `/accounts/${accountId}/d1/database/${databaseId}/query`,
      { method: 'POST', body: JSON.stringify({ sql: `CREATE TABLE IF NOT EXISTS ${tableName} (name TEXT PRIMARY KEY, value TEXT, updated_at TEXT)` }) });
  }
}

async function ensureSyncTable(token, accountId, databaseId) {
  await ensureTable(token, accountId, databaseId, 'okit_sync');
}

async function testConnection(config) {
  if (!config.apiToken) throw new Error('请配置 API Token');

  const accounts = await listAccounts(config.apiToken);
  const accountId = accounts[0]?.id;
  if (!accountId) throw new Error('未找到 Cloudflare 账户');

  const databaseId = await ensureDatabase(config.apiToken, accountId);
  await ensureTable(config.apiToken, accountId, databaseId, 'okit_secrets');

  return `Cloudflare D1 连接成功 (数据库: ${DB_NAME})`;
}

async function syncSecrets(config, secrets) {
  if (!config.apiToken) throw new Error('请配置 API Token');

  const accounts = await listAccounts(config.apiToken);
  const accountId = accounts[0]?.id;
  const databaseId = await ensureDatabase(config.apiToken, accountId);
  const tableName = 'okit_secrets';
  const results = [];

  for (const secret of secrets) {
    try {
      const val = JSON.stringify({ group: secret.group, aliases: secret.aliases });
      await cfFetch(config.apiToken,
        `/accounts/${accountId}/d1/database/${databaseId}/query`,
        { method: 'POST', body: JSON.stringify({
          sql: `INSERT OR REPLACE INTO ${tableName} (name, value, updated_at) VALUES (?, ?, ?)`,
          params: [secret.key, val, new Date().toISOString()],
        }) });
      results.push({ key: secret.key, success: true });
    } catch (error) {
      results.push({ key: secret.key, success: false, error: error.message });
    }
  }
  return results;
}

async function pushSync(config, userId, encryptedBlob) {
  if (!config.apiToken) throw new Error('请配置 API Token');

  const accounts = await listAccounts(config.apiToken);
  const accountId = accounts[0]?.id;
  const databaseId = await ensureDatabase(config.apiToken, accountId);

  await ensureSyncTable(config.apiToken, accountId, databaseId);
  const data = JSON.stringify(encryptedBlob);
  const escaped = data.replace(/'/g, "''");
  await cfFetch(config.apiToken,
    `/accounts/${accountId}/d1/database/${databaseId}/query`,
    { method: 'POST', body: JSON.stringify({
      sql: `INSERT OR REPLACE INTO okit_sync (user_id, data, machine_id, updated_at) VALUES (?, ?, ?, ?)`,
      params: [userId, escaped, encryptedBlob.machineId || '', new Date().toISOString()],
    }) });
}

async function pullSync(config, userId) {
  if (!config.apiToken) throw new Error('请配置 API Token');

  const accounts = await listAccounts(config.apiToken);
  const accountId = accounts[0]?.id;
  const databaseId = await ensureDatabase(config.apiToken, accountId);

  await ensureSyncTable(config.apiToken, accountId, databaseId);
  try {
    const result = await cfFetch(config.apiToken,
      `/accounts/${accountId}/d1/database/${databaseId}/query`,
      { method: 'POST', body: JSON.stringify({
        sql: `SELECT data FROM okit_sync WHERE user_id = ?`,
        params: [userId],
      }) });
    const rows = result.result?.[0]?.results;
    if (!rows || rows.length === 0) return null;
    return JSON.parse(rows[0].data);
  } catch {
    return null;
  }
}

module.exports = { name: 'Cloudflare D1', testConnection, syncSecrets, pushSync, pullSync };
