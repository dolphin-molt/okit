const tencentcloud = require('tencentcloud-sdk-nodejs-ssm');
const SsmClient = tencentcloud.ssm.v20190923.Client;

function createClient(config) {
  if (!config.secretId || !config.secretKey) {
    throw new Error('请配置 SecretId 和 SecretKey');
  }
  return new SsmClient({
    credential: {
      secretId: config.secretId,
      secretKey: config.secretKey,
    },
    region: config.region || 'ap-guangzhou',
    profile: {
      httpProfile: { endpoint: 'ssm.tencentcloudapi.com' },
    },
  });
}

async function testConnection(config) {
  const client = createClient(config);
  try {
    await client.ListSecrets({ MaxResults: 1 });
    return `腾讯云 SSM (${config.region || 'ap-guangzhou'}) 连接成功`;
  } catch (error) {
    const msg = error.message || String(error);
    if (msg.includes('AuthFailure')) {
      throw new Error('认证失败，请检查 SecretId/SecretKey');
    }
    throw new Error(msg);
  }
}

async function syncSecrets(config, secrets) {
  const client = createClient(config);
  const results = [];

  for (const secret of secrets) {
    const secretName = `okit/${secret.key}`;
    try {
      try {
        await client.CreateSecret({
          SecretName: secretName,
          SecretString: secret.value,
          Description: 'Managed by OKIT',
        });
      } catch (e) {
        if (e.code === 'ResourceExists' || e.message?.includes('already exist')) {
          await client.UpdateSecret({
            SecretName: secretName,
            SecretString: secret.value,
          });
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

  try {
    await client.CreateSecret({ SecretName: secretName, SecretString: value, Description: 'OKIT sync data' });
  } catch (e) {
    if (e.code === 'ResourceExists' || e.message?.includes('already exist')) {
      await client.UpdateSecret({ SecretName: secretName, SecretString: value });
    } else {
      throw e;
    }
  }
}

async function pullSync(config, userId) {
  const client = createClient(config);
  const secretName = `okit/sync/${userId}`;

  try {
    const result = await client.GetSecretValue({ SecretName: secretName });
    if (!result.SecretString) return null;
    return JSON.parse(result.SecretString);
  } catch (e) {
    if (e.code === 'ResourceNotFound') return null;
    throw e;
  }
}

module.exports = { name: '腾讯云 SSM', testConnection, syncSecrets, pushSync, pullSync };
