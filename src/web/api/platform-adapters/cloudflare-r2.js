const fetch = require('node-fetch');
const crypto = require('crypto');

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
  if (!config.bucketName) throw new Error('请配置 Bucket 名称');

  const accounts = await listAccounts(config.apiToken);
  const accountId = accounts[0]?.id;
  if (!accountId) throw new Error('未找到 Cloudflare 账户');

  // List buckets to verify access
  const data = await cfFetch(config.apiToken, `/accounts/${accountId}/r2/buckets`);
  const buckets = data.result || [];
  const found = buckets.find(b => b.name === config.bucketName);
  if (!found) throw new Error(`Bucket "${config.bucketName}" 不存在`);
  return `Cloudflare R2 (${config.bucketName}) 连接成功`;
}

async function syncSecrets(config, secrets) {
  if (!config.apiToken) throw new Error('apiToken is required');
  if (!config.bucketName) throw new Error('bucketName is required');

  const accounts = await listAccounts(config.apiToken);
  const accountId = accounts[0]?.id;
  if (!accountId) throw new Error('未找到 Cloudflare 账户');

  // Use Workers for Platforms API to upload objects
  // R2 object upload via REST API requires S3-compatible API with presigned URLs
  // For simplicity, we use the Cloudflare API to create a worker that writes to R2
  // Alternative: use the S3 API directly with R2 credentials

  // For now, store secrets as a single JSON object using the Cloudflare API
  const results = [];

  try {
    // Upload as a single encrypted bundle
    const bundle = {};
    for (const secret of secrets) {
      bundle[secret.key] = secret.value;
    }

    const payload = JSON.stringify({
      bundle,
      updatedAt: new Date().toISOString(),
    });

    // Use S3-compatible API if R2 credentials are provided
    // Otherwise fall back to storing via D1 or notes
    // For R2, we need to use the S3 API which requires separate credentials
    // Let's use a simpler approach: store via the Cloudflare Workers API

    // Actually, R2 doesn't have a simple REST upload API without S3 credentials
    // We'll create an S3-compatible request using the API token
    // But Cloudflare API Token doesn't directly support S3 API for R2
    // R2 requires S3 API credentials (Access Key ID + Secret Access Key)

    // Check if S3 credentials are provided
    if (config.r2AccessKeyId && config.r2SecretAccessKey) {
      // Use S3-compatible API
      for (const secret of secrets) {
        try {
          const body = JSON.stringify({
            name: secret.key,
            value: secret.value,
            updatedAt: new Date().toISOString(),
          });
          const key = `secrets/${secret.key}.json`;
          await s3PutObject(config, key, body);
          results.push({ key: secret.key, success: true });
        } catch (error) {
          results.push({ key: secret.key, success: false, error: error.message });
        }
      }
    } else {
      throw new Error('R2 需要 S3 兼容凭据（R2 Access Key ID + Secret Access Key）');
    }
  } catch (error) {
    // If bundle approach fails, report error for all
    for (const secret of secrets) {
      results.push({ key: secret.key, success: false, error: error.message });
    }
  }

  return results;
}

async function s3PutObject(config, key, body) {
  const endpoint = `https://${config.bucketName}.${config.r2AccessKeyId}.r2.cloudflarestorage.com`;
  const url = `${endpoint}/${key}`;

  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = date.slice(0, 8);

  const contentSha256 = crypto.createHash('sha256').update(body).digest('hex');

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT', `/${key}`, '',
    `content-type:application/json`, `host:${url.replace('https://', '').split('/')[0]}`,
    `x-amz-content-sha256:${contentSha256}`, `x-amz-date:${date}`,
    '', signedHeaders, contentSha256,
  ].join('\n');

  const scope = `${shortDate}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

  const signingKey = ['AWS4' + config.r2SecretAccessKey, shortDate, 'auto', 's3', 'aws4_request']
    .reduce((key, msg) => crypto.createHmac('sha256', key).update(msg).digest(), '');

  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const res = await fetch(url, {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': 'application/json',
      'x-amz-content-sha256': contentSha256,
      'x-amz-date': date,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${config.r2AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 upload failed: ${res.status} ${text}`);
  }
}

async function s3GetObject(config, key) {
  const endpoint = `https://${config.bucketName}.${config.r2AccessKeyId}.r2.cloudflarestorage.com`;
  const url = `${endpoint}/${key}`;

  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = date.slice(0, 8);

  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'GET', `/${key}`, '',
    `host:${url.replace('https://', '').split('/')[0]}`,
    `x-amz-content-sha256:UNSIGNED-PAYLOAD`, `x-amz-date:${date}`,
    '', signedHeaders, 'UNSIGNED-PAYLOAD',
  ].join('\n');

  const scope = `${shortDate}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

  const signingKey = ['AWS4' + config.r2SecretAccessKey, shortDate, 'auto', 's3', 'aws4_request']
    .reduce((key, msg) => crypto.createHmac('sha256', key).update(msg).digest(), '');

  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': date,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${config.r2AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET failed: ${res.status}`);
  const text = await res.text();
  return JSON.parse(text);
}

async function pushSync(config, userId, encryptedBlob) {
  if (!config.r2AccessKeyId || !config.r2SecretAccessKey) {
    throw new Error('R2 需要 S3 兼容凭据');
  }
  const key = `sync/${userId}.json`;
  await s3PutObject(config, key, JSON.stringify(encryptedBlob));
}

async function pullSync(config, userId) {
  if (!config.r2AccessKeyId || !config.r2SecretAccessKey) {
    throw new Error('R2 需要 S3 兼容凭据');
  }
  const key = `sync/${userId}.json`;
  return await s3GetObject(config, key);
}

module.exports = { name: 'Cloudflare R2', testConnection, syncSecrets, pushSync, pullSync };
