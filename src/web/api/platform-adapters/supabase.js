const fetch = require('node-fetch');

const TABLE_NAME = 'okit_sync';

function getBaseUrl(config) {
  if (!config.projectId) throw new Error('请配置项目 ID');
  return `https://${config.projectId}.supabase.co`;
}

function headers(apiKey) {
  return {
    'Content-Type': 'application/json',
    'apikey': apiKey,
    'Authorization': `Bearer ${apiKey}`,
    'Prefer': 'resolution=merge-duplicates',
  };
}

async function sbFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase error (${res.status}): ${text}`);
  }
  try { return JSON.parse(text); } catch { return null; }
}

async function testConnection(config) {
  if (!config.apiKey) throw new Error('请配置 Secret Key');
  const base = getBaseUrl(config);
  const h = headers(config.apiKey);
  // Verify table exists by selecting from it
  try {
    await sbFetch(`${base}/rest/v1/${TABLE_NAME}?select=id&limit=1`, { headers: h });
  } catch (e) {
    if (e.message.includes('404') || e.message.includes('does not exist') || e.message.includes('relation')) {
      throw new Error(`表 ${TABLE_NAME} 不存在，请先在配置指南中复制建表 SQL 到 SQL Editor 执行`);
    }
    throw e;
  }
  return 'Supabase 连接成功（表已就绪）';
}

async function syncSecrets(config, secrets) {
  const base = getBaseUrl(config);
  const h = headers(config.apiKey);
  const results = [];
  for (const secret of secrets) {
    try {
      const value = { group: secret.group, aliases: secret.aliases };
      const row = { key: secret.key, value, updated_at: new Date().toISOString() };
      // Try update first
      const updated = await sbFetch(`${base}/rest/v1/${TABLE_NAME}?key=eq.${encodeURIComponent(secret.key)}`, {
        method: 'PATCH',
        headers: { ...h, 'Prefer': 'return=representation' },
        body: JSON.stringify(row),
      });
      // If no row updated, insert new
      if (!updated || updated.length === 0) {
        await sbFetch(`${base}/rest/v1/${TABLE_NAME}`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify(row),
        });
      }
      results.push({ key: secret.key, success: true });
    } catch (error) {
      results.push({ key: secret.key, success: false, error: error.message });
    }
  }
  return results;
}

async function pushSync(config, userId, encryptedBlob) {
  if (!config.apiKey) throw new Error('请配置 Secret Key');
  const base = getBaseUrl(config);
  const h = headers(config.apiKey);
  const syncKey = `sync-${userId}`;

  // Upsert: try insert first, then update on conflict
  try {
    await sbFetch(`${base}/rest/v1/${TABLE_NAME}`, {
      method: 'POST',
      headers: { ...h, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: syncKey, value: encryptedBlob, updated_at: new Date().toISOString() }),
    });
  } catch (e) {
    // If table doesn't exist, provide clear error
    if (e.message.includes('404') || e.message.includes('does not exist') || e.message.includes('relation')) {
      throw new Error(`表 ${TABLE_NAME} 不存在。请在 Supabase SQL Editor 中建表后再试。`);
    }
    throw e;
  }
}

async function pullSync(config, userId) {
  if (!config.apiKey) throw new Error('请配置 Secret Key');
  const base = getBaseUrl(config);
  const h = headers(config.apiKey);
  const syncKey = `sync-${userId}`;
  try {
    const rows = await sbFetch(`${base}/rest/v1/${TABLE_NAME}?key=eq.${encodeURIComponent(syncKey)}&select=value&limit=1`, { headers: h });
    if (!rows || rows.length === 0) return null;
    return rows[0].value;
  } catch (e) {
    if (e.message.includes('404') || e.message.includes('does not exist')) return null;
    throw e;
  }
}

module.exports = { name: 'Supabase', testConnection, syncSecrets, pushSync, pullSync };
