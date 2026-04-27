const volcengine = require('@volcengine/openapi');

function createClient(config) {
  if (!config.accessKey || !config.secretKey) {
    throw new Error('请配置 AccessKey 和 SecretKey');
  }
  const service = volcengine.Service.getInstance('kms');
  service.setAccessKeyId(config.accessKey);
  service.setSecretKey(config.secretKey);
  if (config.region) {
    service.setRegion(config.region);
  }
  return service;
}

async function testConnection(config) {
  try {
    const client = createClient(config);
    return `火山引擎 KMS (${config.region || 'cn-beijing'}) 连接成功`;
  } catch (error) {
    throw new Error(error.message || '连接失败');
  }
}

async function syncSecrets(config, secrets) {
  const client = createClient(config);
  const results = [];

  for (const secret of secrets) {
    const secretName = `okit/${secret.key}`;
    try {
      await client.createSecret({
        SecretName: secretName,
        SecretData: secret.value,
        Description: 'Managed by OKIT',
      });
      results.push({ key: secret.key, success: true });
    } catch (error) {
      // If exists, try update
      if (error.message?.includes('already exist') || error.message?.includes('Conflict')) {
        try {
          await client.putSecretValue({
            SecretName: secretName,
            SecretData: secret.value,
          });
          results.push({ key: secret.key, success: true });
          continue;
        } catch (updateError) {
          results.push({ key: secret.key, success: false, error: updateError.message });
          continue;
        }
      }
      results.push({ key: secret.key, success: false, error: error.message });
    }
  }
  return results;
}

async function pushSync(config, userId, encryptedBlob) {
  const client = createClient(config);
  const secretName = `okit/sync/${userId}`;
  const value = JSON.stringify(encryptedBlob);

  try {
    await client.createSecret({ SecretName: secretName, SecretData: value, Description: 'OKIT sync data' });
  } catch (e) {
    if (e.message?.includes('already exist') || e.message?.includes('Conflict')) {
      await client.putSecretValue({ SecretName: secretName, SecretData: value });
    } else {
      throw e;
    }
  }
}

async function pullSync(config, userId) {
  const client = createClient(config);
  const secretName = `okit/sync/${userId}`;

  try {
    const result = await client.getSecretValue({ SecretName: secretName });
    if (!result.SecretData) return null;
    return JSON.parse(result.SecretData);
  } catch (e) {
    if (e.message?.includes('not exist')) return null;
    throw e;
  }
}

module.exports = { name: '火山引擎 KMS', testConnection, syncSecrets, pushSync, pullSync };
