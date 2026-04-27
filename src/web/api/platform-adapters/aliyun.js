const Kms20160120 = require('@alicloud/kms20160120');
const OpenApi = require('@alicloud/openapi-core');

function createClient(config) {
  if (!config.accessKeyId || !config.accessKeySecret) {
    throw new Error('请配置 AccessKeyId 和 AccessKeySecret');
  }
  const clientConfig = new OpenApi.Config({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    endpoint: `kms.${config.region || 'cn-hangzhou'}.aliyuncs.com`,
  });
  return new Kms20160120(clientConfig);
}

async function testConnection(config) {
  const client = createClient(config);
  try {
    await client.listSecretsWithOptions({
      pageSize: 1,
      pageNumber: 1,
    }, new OpenApi.RuntimeOptions({ readTimeout: 10000 }));
    return `阿里云 KMS (${config.region || 'cn-hangzhou'}) 连接成功`;
  } catch (error) {
    const msg = error.message || String(error);
    if (msg.includes('Forbidden') || msg.includes('SecurityTokenExpired')) {
      throw new Error('认证失败，请检查 AccessKeyId/AccessKeySecret');
    }
    throw new Error(msg);
  }
}

async function syncSecrets(config, secrets) {
  const client = createClient(config);
  const prefix = config.secretNamePrefix || 'okit/';
  const results = [];
  const opts = new OpenApi.RuntimeOptions({ readTimeout: 15000 });

  for (const secret of secrets) {
    const secretName = `${prefix}${secret.key}`;
    try {
      // Try to create, if exists then update
      try {
        await client.createSecretWithOptions({
          secretName,
          secretData: secret.value,
          secretType: 'Generic',
          description: `Managed by OKIT`,
        }, opts);
      } catch (e) {
        if (e.message?.includes('already exist') || e.message?.includes('Conflict')) {
          await client.putSecretValueWithOptions({
            secretName,
            secretData: secret.value,
          }, opts);
        } else {
          throw e;
        }
      }
      results.push({ key: secret.key, success: true });
    } catch (error) {
      results.push({ key: secret.key, success: false, error: error.message });
    }
  }
  return results;
}

async function pushSync(config, userId, encryptedBlob) {
  const client = createClient(config);
  const secretName = `okit/sync/${userId}`;
  const value = JSON.stringify(encryptedBlob);
  const opts = new OpenApi.RuntimeOptions({ readTimeout: 15000 });

  try {
    await client.createSecretWithOptions({
      secretName,
      secretData: value,
      secretType: 'Generic',
      description: 'OKIT sync data',
    }, opts);
  } catch (e) {
    if (e.message?.includes('already exist') || e.message?.includes('Conflict')) {
      await client.putSecretValueWithOptions({ secretName, secretData: value }, opts);
    } else {
      throw e;
    }
  }
}

async function pullSync(config, userId) {
  const client = createClient(config);
  const secretName = `okit/sync/${userId}`;
  const opts = new OpenApi.RuntimeOptions({ readTimeout: 15000 });

  try {
    const result = await client.getSecretValueWithOptions({ secretName }, opts);
    if (!result.body?.secretData) return null;
    return JSON.parse(result.body.secretData);
  } catch (e) {
    if (e.message?.includes('not exist')) return null;
    throw e;
  }
}

module.exports = { name: '阿里云 KMS', testConnection, syncSecrets, pushSync, pullSync };
