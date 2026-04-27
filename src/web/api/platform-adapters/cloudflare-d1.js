const fetch = require('node-fetch');

const API_BASE = 'https://api.cloudflare.com/client/v4';

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

async function testConnection(config) {
  if (!config.apiToken) throw new Error('请配置 API Token');
  if (!config.databaseId) throw new Error('请配置 Database ID');

  const accounts = await listAccounts(config.apiToken);
  const accountId = accounts[0]?.id;
  if (!accountId) throw new Error('未找到 Cloudflare 账户');

  const tableName = config.tableName || 'okit_secrets';
  try {
    await cfFetch(config.apiToken,
      `/accounts/${accountId}/d1/database/${config.databaseId}/query`,
      { method: 'POST', body: JSON.stringify({ sql: `SELECT name FROM ${tableName} LIMIT 1` }) });
  } catch (e) {
    if (e.message.includes('no such table')) {
      await cfFetch(config.apiToken,
        `/accounts/${accountId}/d1/database/${config.databaseId}/query`,
        { method: 'POST', body: JSON.stringify({ sql: `CREATE TABLE IF NOT EXISTS ${tableName} (name TEXT PRIMARY KEY, value TEXT, updated_at TEXT)` }) });
    } else {
      throw e;
    }
  }
  return `Cloudflare D1 (${config.databaseId}) 连接成功`;
}

async function syncSecrets(config, secrets) {
  if (!config.apiToken) throw new Error('apiToken is required');
  if (!config.databaseId) throw new Error('databaseId is required');

  const accounts = await listAccounts(config.apiToken);
  const accountId = accounts[0]?.id;
  if (!accountId) throw new Error('未找到 Cloudflare 账户');

  const tableName = config.tableName || 'okit_secrets';
  const results = [];

  for (const secret of secrets) {
    try {
      const escaped = secret.value.replace(/'/g, "''");
      await cfFetch(config.apiToken,
        `/accounts/${accountId}/d1/database/${config.databaseId}/query`,
        { method: 'POST', body: JSON.stringify({
          sql: `INSERT OR REPLACE INTO ${tableName} (name, value, updated_at) VALUES (?, ?, ?)`,
          params: [secret.key, secret.value, new Date().toISOString()],
        }) });
      results.push({ key: secret.key, success: true });
    } catch (error) {
      results.push({ key: secret.key, success: false, error: error.message });
    }
  }
  return results;
}

async function ensureSyncTable(config, accountId) {
  const tableName = 'okit_sync';
  try {
    await cfFetch(config.apiToken,
      `/accounts/${accountId}/d1/database/${config.databaseId}/query`,
      { method: 'POST', body: JSON.stringify({ sql: `SELECT 1 FROM ${tableName} LIMIT 1` }) });
  } catch {
    await cfFetch(config.apiToken,
      `/accounts/${accountId}/d1/database/${config.databaseId}/query`,
      { method: 'POST', body: JSON.stringify({ sql: `CREATE TABLE IF NOT EXISTS ${tableName} (user_id TEXT PRIMARY KEY, data TEXT, machine_id TEXT, updated_at TEXT)` }) });
  }
}

async function pushSync(config, userId, encryptedBlob) {
  if (!config.apiToken || !config.databaseId) throw new Error('请配置 API Token 和 Database ID');
  const accounts = await listAccounts(config.apiToken);
  const accountId = accounts[0]?.id;
  if (!accountId) throw new Error('未找到 Cloudflare 账户');

  await ensureSyncTable(config, accountId);
  const data = JSON.stringify(encryptedBlob);
  const escaped = data.replace(/'/g, "''");
  await cfFetch(config.apiToken,
    `/accounts/${accountId}/d1/database/${config.databaseId}/query`,
    { method: 'POST', body: JSON.stringify({
      sql: `INSERT OR REPLACE INTO okit_sync (user_id, data, machine_id, updated_at) VALUES (?, ?, ?, ?)`,
      params: [userId, escaped, encryptedBlob.machineId || '', new Date().toISOString()],
    }) });
}

async function pullSync(config, userId) {
  if (!config.apiToken || !config.databaseId) throw new Error('请配置 API Token 和 Database ID');
  const accounts = await listAccounts(config.apiToken);
  const accountId = accounts[0]?.id;
  if (!accountId) throw new Error('未找到 Cloudflare 账户');

  await ensureSyncTable(config, accountId);
  try {
    const result = await cfFetch(config.apiToken,
      `/accounts/${accountId}/d1/database/${config.databaseId}/query`,
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
