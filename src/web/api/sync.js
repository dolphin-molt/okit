const core = require('./cloud-sync-core');
const scheduler = require('./sync-scheduler');
const os = require('os');
const { execSync } = require('child_process');

// Friendly machine label: the macOS ComputerName (what the user set in System
// Settings), falling back to the hostname on other platforms. Cached — it
// rarely changes and scutil shouldn't run on every status poll.
let cachedMachineName;
function getMachineName() {
  if (cachedMachineName) return cachedMachineName;
  try {
    if (process.platform === 'darwin') {
      cachedMachineName = execSync('scutil --get ComputerName', { timeout: 2000 }).toString().trim();
    }
  } catch {}
  if (!cachedMachineName) cachedMachineName = os.hostname();
  return cachedMachineName;
}

async function handlePush(req, res) {
  try {
    if (scheduler.isBusy()) return res.status(409).json({ error: '同步正在进行中，请稍候再试' });
    const { busy, error, result } = await scheduler.runExclusive(() => core.syncPush());
    if (busy) return res.status(409).json({ error: '同步正在进行中，请稍候再试' });
    if (error) throw error;
    res.json({ success: true, message: `已推送 ${result.secrets} 个密钥 → ${result.platform}`, ...result });
  } catch (error) {
    console.error('Sync push error:', error);
    res.status(500).json({ error: error.message || '推送失败' });
  }
}

async function handlePull(req, res) {
  try {
    if (scheduler.isBusy()) return res.status(409).json({ error: '同步正在进行中，请稍候再试' });
    const { busy, error, result } = await scheduler.runExclusive(() => core.syncPull());
    if (busy) return res.status(409).json({ error: '同步正在进行中，请稍候再试' });
    if (error) throw error;
    const kept = [];
    if (!result.agentApplied) kept.push('Agent 配置保留本机');
    if (!result.providersApplied) kept.push('模型商配置保留本机');
    const keptNote = kept.length > 0 ? `（${kept.join('，')}）` : '';
    res.json({
      success: true,
      message: `拉取完成：新增 ${result.added} 个，更新 ${result.updated} 个${keptNote}`,
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
    const enabledIds = Object.keys(platforms).filter(id => platforms[id]?.enabled);
    const primary = enabledIds.includes(sync.syncPlatform) ? sync.syncPlatform : enabledIds[0] || null;

    res.json({
      machineId: sync.machineId || null,
      machineName: getMachineName(),
      lastSyncAt: sync.lastSyncAt || null,
      platformId: primary,
      platforms: enabledIds,
      hasPassword: !!sync.password,
      autoSync: !!sync.autoSync,
      autoBusy: scheduler.isBusy(),
      localDirty: scheduler.hasPendingLocalChanges(sync),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get sync status' });
  }
}

async function handleExportCode(req, res) {
  try {
    const result = await core.exportSyncCode(req.body?.password);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Sync code export error:', error);
    res.status(500).json({ error: error.message || '导出同步码失败' });
  }
}

async function handleImportCode(req, res) {
  try {
    const { code, password } = req.body || {};
    if (!code) return res.status(400).json({ error: '同步码不能为空' });
    const result = await core.importSyncCode(code, password);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Sync code import error:', error);
    const status = error.message?.includes('同步密码不正确') || error.message?.includes('格式不正确') ? 400 : 500;
    res.status(status).json({ error: error.message || '导入同步码失败' });
  }
}

module.exports = { handlePush, handlePull, handleStatus, handleExportCode, handleImportCode };
