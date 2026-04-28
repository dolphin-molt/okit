const core = require('./cloud-sync-core');

async function handlePush(req, res) {
  try {
    const result = await core.syncPush();
    res.json({ success: true, message: `已推送 ${result.secrets} 个密钥`, ...result });
  } catch (error) {
    console.error('Sync push error:', error);
    res.status(500).json({ error: error.message || '推送失败' });
  }
}

async function handlePull(req, res) {
  try {
    const result = await core.syncPull();
    res.json({
      success: true,
      message: `拉取完成：新增 ${result.added} 个，更新 ${result.updated} 个`,
      ...result,
    });
  } catch (error) {
    console.error('Sync pull error:', error);
    if (error.message?.includes('Unsupported state') || error.message?.includes('AUTHENTICATION_FAILED')) {
      return res.status(400).json({ error: '同步密码不正确，无法解密远端数据' });
    }
    res.status(500).json({ error: error.message || '拉取失败' });
  }
}

async function handleStatus(req, res) {
  try {
    const config = await core.loadConfig();
    const sync = config.sync || {};
    const platforms = sync.platforms || {};
    const target = sync.syncPlatform;
    const hasEnabled = target && platforms[target]?.enabled;

    res.json({
      machineId: sync.machineId || null,
      lastSyncAt: sync.lastSyncAt || null,
      platformId: hasEnabled ? target : null,
      hasPassword: !!sync.password,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get sync status' });
  }
}

module.exports = { handlePush, handlePull, handleStatus };
