const { Service } = require('@volcengine/openapi');

const KMS_VERSION = '2021-02-18';

function createClient(config) {
  if (!config.accessKey || !config.secretKey) {
    throw new Error('请配置 AccessKey 和 SecretKey');
  }
  const service = new Service();
  service.setAccessKeyId(config.accessKey);
  service.setSecretKey(config.secretKey);
  return service;
}

async function kmsCall(client, action, query, body) {
  const opts = {
    Action: action,
    Version: KMS_VERSION,
    query,
  };
  if (body) {
    opts.method = 'POST';
    opts.data = body;
    opts.headers = { 'Content-Type': 'application/json; charset=utf-8' };
  }
  const result = await client.fetchOpenAPI(opts, {
    host: 'open.volcengineapi.com',
    region: 'cn-beijing',
    serviceName: 'kms',
  });
  const err = result.ResponseMetadata?.Error;
  if (err) throw new Error(`${err.Code}: ${err.Message}`);
  return result;
}

async function testConnection(config) {
  const client = createClient(config);
  try {
    await kmsCall(client, 'DescribeSecrets', {});
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('not activated') || msg.includes('未开通') || msg.includes('ServiceNotActivated') || msg.includes('ServiceNotOpen') || msg.includes('NotOpen')) {
      throw new Error('凭据管理服务未开通，请在火山引擎控制台开通密钥管理服务（含凭据管理）');
    }
    throw e;
  }
  return '火山引擎 KMS 连接成功';
}

function secretName(key) {
  return 'okit-' + key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function pushSync(config, userId, encryptedBlob) {
  const client = createClient(config);
  const name = secretName('sync-' + userId);
  const value = JSON.stringify(encryptedBlob);

  try {
    await kmsCall(client, 'CreateSecret',
      { SecretName: name, SecretType: 'Generic' },
      { SecretValue: value, Description: 'OKIT sync data' },
    );
  } catch (e) {
    if (e.message?.includes('already exist') || e.message?.includes('Conflict') || e.message?.includes('already')) {
      await kmsCall(client, 'SetSecretValue',
        { SecretName: name },
        { SecretValue: value },
      );
    } else {
      throw e;
    }
  }
}

async function pullSync(config, userId) {
  const client = createClient(config);
  const name = secretName('sync-' + userId);

  try {
    const result = await kmsCall(client, 'GetSecretValue', { SecretName: name });
    if (!result?.SecretValue) return null;
    return JSON.parse(result.SecretValue);
  } catch (e) {
    if (e.message?.includes('not exist') || e.message?.includes('not found')) return null;
    throw e;
  }
}

module.exports = { name: '火山引擎 KMS', testConnection, pushSync, pullSync };
