import { useEffect, useState } from 'react';
import { getSettings, updateSettings, testPlatform, testAgent } from '../../api/settings';
import { listVault, setVault } from '../../api/vault';
import { pushSync, pullSync, getSyncStatus } from '../../api/sync';
import { PROVIDER_PRESETS, PLATFORM_FIELDS, PLATFORM_IDS } from '../../lib/constants';
import { useApp } from '../Layout/AppContext';

export default function SettingsPage() {
  const { showToast, setConnectionStatus, theme, toggleTheme } = useApp() as any;
  const [autoSync, setAutoSync] = useState(false);
  const [agent, setAgent] = useState({ provider: 'siliconflow', model: '', baseUrl: '', apiKeyVaultKey: '' });
  const [platforms, setPlatforms] = useState<Record<string, any>>({});
  const [vaultKeys, setVaultKeys] = useState<string[]>([]);
  const [modelCustom, setModelCustom] = useState('');
  const [showModelCustom, setShowModelCustom] = useState(false);
  const [testingPlatform, setTestingPlatform] = useState<string | null>(null);
  const [testingAgent, setTestingAgent] = useState(false);
  const [vaultFormKey, setVaultFormKey] = useState('');
  const [vaultFormValue, setVaultFormValue] = useState('');
  const [vaultFormGroup, setVaultFormGroup] = useState('');
  const [vaultFormVisible, setVaultFormVisible] = useState(false);
  const [syncPassword, setSyncPassword] = useState('');
  const [syncStatus, setSyncStatus] = useState<{ machineId: string | null; lastSyncAt: string | null; platformId: string | null; hasPassword: boolean } | null>(null);
  const [syncing, setSyncing] = useState<'push' | 'pull' | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [settingsData, vaultData, status] = await Promise.all([getSettings(), listVault(), getSyncStatus()]);
      const s = settingsData as any;
      setAutoSync(!!s.sync?.autoSync);
      if (s.sync?.password && s.sync.password !== '***') {
        setSyncPassword(s.sync.password);
      }
      if (s.agent) {
        setAgent(s.agent);
        const preset = PROVIDER_PRESETS[s.agent.provider];
        if (preset && !preset.models.includes(s.agent.model) && s.agent.model) {
          setModelCustom(s.agent.model);
          setShowModelCustom(true);
        }
      }
      setPlatforms(s.sync?.platforms || {});
      setSyncStatus(status as any);
      const keys = (vaultData.secrets || []).map((s: any) => s.key).filter(Boolean);
      setVaultKeys(keys);
      setConnectionStatus('connected');
    } catch { setConnectionStatus('error'); }
  }

  async function saveAll(newAgent?: typeof agent, newAutoSync?: boolean, newPlatforms?: typeof platforms, password?: string) {
    const a = newAgent || agent;
    const as = newAutoSync !== undefined ? newAutoSync : autoSync;
    const p = newPlatforms || platforms;
    const sync: any = { autoSync: as, platforms: p };
    if (password) sync.password = password;
    try {
      await updateSettings({ sync, agent: a });
    } catch { showToast('保存失败', 'error'); }
  }

  // Agent settings handlers
  function onProviderChange(provider: string) {
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) return;
    const newAgent = { ...agent, provider, baseUrl: preset.baseUrl, apiKeyVaultKey: preset.apiKeyVaultKey, model: preset.models[0] || '' };
    setAgent(newAgent);
    setShowModelCustom(false);
    setModelCustom('');
    saveAll(newAgent);
  }

  function onModelChange(val: string) {
    if (val === '__custom__') {
      setShowModelCustom(true);
      setModelCustom('');
    } else {
      setShowModelCustom(false);
      const newAgent = { ...agent, model: val };
      setAgent(newAgent);
      saveAll(newAgent);
    }
  }

  function onBaseUrlChange(baseUrl: string) {
    const newAgent = { ...agent, baseUrl };
    setAgent(newAgent);
  }

  function onBaseUrlBlur() { saveAll(); }

  function onVaultKeyChange(apiKeyVaultKey: string) {
    const newAgent = { ...agent, apiKeyVaultKey };
    setAgent(newAgent);
    saveAll(newAgent);
  }

  async function handleTestAgent() {
    setTestingAgent(true);
    await saveAll();
    try {
      const data = await testAgent();
      showToast(data.message || (data.success ? '连接成功' : '连接失败'), data.success ? 'success' : 'error');
    } catch { showToast('测试连接失败', 'error'); } finally { setTestingAgent(false); }
  }

  // Sync handlers
  async function handlePushSync() {
    if (!syncPassword) { showToast('请先设置同步密码', 'error'); return; }
    setSyncing('push');
    try {
      const data = await pushSync();
      if (data.success) {
        showToast(`推送成功：${data.secrets || 0} 个密钥`);
        const status = await getSyncStatus();
        setSyncStatus(status as any);
      } else {
        showToast(data.message || '推送失败', 'error');
      }
    } catch { showToast('推送失败', 'error'); } finally { setSyncing(null); }
  }

  async function handlePullSync() {
    if (!syncPassword) { showToast('请先设置同步密码', 'error'); return; }
    setSyncing('pull');
    try {
      const data = await pullSync();
      if (data.success) {
        showToast(`拉取成功：新增 ${data.added || 0}，更新 ${data.updated || 0}`);
        loadData();
      } else {
        showToast(data.message || '拉取失败', 'error');
      }
    } catch { showToast('拉取失败', 'error'); } finally { setSyncing(null); }
  }

  // Vault quick-add
  function openVaultAdd() {
    setVaultFormKey('');
    setVaultFormValue('');
    setVaultFormGroup('');
    setVaultFormVisible(true);
  }

  async function saveVaultQuick() {
    if (!vaultFormKey || !vaultFormValue) { showToast('Key 和 Value 不能为空', 'error'); return; }
    try {
      await setVault({ key: vaultFormKey, alias: 'default', value: vaultFormValue, group: vaultFormGroup || undefined });
      showToast('密钥已添加');
      setVaultFormVisible(false);
      const newAgent = { ...agent, apiKeyVaultKey: vaultFormKey };
      setAgent(newAgent);
      setVaultKeys(prev => [...prev, vaultFormKey]);
      saveAll(newAgent);
    } catch { showToast('保存失败', 'error'); }
  }

  // Platform settings
  function updatePlatform(id: string, field: string, value: any) {
    const newPlatforms = { ...platforms, [id]: { ...(platforms[id] || {}), [field]: value } };
    setPlatforms(newPlatforms);
  }

  async function savePlatformSettings() {
    await saveAll(undefined, undefined, platforms);
  }

  async function handleTestPlatform(platformId: string) {
    setTestingPlatform(platformId);
    await savePlatformSettings();
    try {
      const data = await testPlatform(platformId);
      showToast(data.message || (data.success ? '连接成功' : '连接失败'), data.success ? 'success' : 'error');
    } catch { showToast('测试失败', 'error'); } finally { setTestingPlatform(null); }
  }

  const currentPreset = PROVIDER_PRESETS[agent.provider];
  const models = currentPreset?.models || [];

  return (
    <div>

      {/* Appearance */}
      <div className="settings-section">
        <div className="settings-card">
          <div className="settings-card-body">
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">深色模式</div>
                <div className="settings-row-desc">跟随系统或手动切换外观主题</div>
              </div>
              <label className="settings-toggle">
                <input type="checkbox" checked={theme === 'dark'} onChange={toggleTheme} />
                <span className="settings-toggle-slider" />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Auto Sync Toggle */}
      <div className="settings-section">
        <div className="settings-card">
          <div className="settings-card-body">
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">密钥自动同步</div>
                <div className="settings-row-desc">添加新密钥后自动同步到已启用的平台</div>
              </div>
              <label className="settings-toggle">
                <input type="checkbox" checked={autoSync} onChange={e => { setAutoSync(e.target.checked); saveAll(undefined, e.target.checked); }} />
                <span className="settings-toggle-slider" />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Agent Settings */}
      <div className="settings-section">
        <div className="settings-section-title">AI 助手</div>
        <div className="settings-card">
          <div className="settings-card-body">
            <div className="settings-field">
              <label>服务商</label>
              <select className="settings-input settings-select" value={agent.provider} onChange={e => onProviderChange(e.target.value)}>
                {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
                  <option key={key} value={key}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="settings-field">
              <label>模型</label>
              <select className="settings-input settings-select" value={showModelCustom ? '__custom__' : agent.model} onChange={e => onModelChange(e.target.value)}>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
                <option value="__custom__">手动输入...</option>
              </select>
              {showModelCustom && (
                <input type="text" className="settings-input" style={{ marginTop: 4 }} placeholder="输入模型名称"
                  value={modelCustom} onChange={e => setModelCustom(e.target.value)} onBlur={() => { const a = { ...agent, model: modelCustom }; setAgent(a); saveAll(a); }} />
              )}
            </div>
            <div className="settings-field">
              <label>API 地址</label>
              <input type="text" className="settings-input" placeholder="https://..." value={agent.baseUrl} onChange={e => onBaseUrlChange(e.target.value)} onBlur={onBaseUrlBlur} />
            </div>
            <div className="settings-field">
              <label>密钥名称</label>
              <select className="settings-input settings-select" value={agent.apiKeyVaultKey} onChange={e => onVaultKeyChange(e.target.value)}>
                {vaultKeys.map(k => <option key={k} value={k}>{k}</option>)}
                {agent.apiKeyVaultKey && !vaultKeys.includes(agent.apiKeyVaultKey) && (
                  <option value={agent.apiKeyVaultKey}>{agent.apiKeyVaultKey} (未创建)</option>
                )}
              </select>
              <button className="settings-vault-new-btn" onClick={openVaultAdd} title="新建密钥">
                <svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 3v12M3 9h12" /></svg>
              </button>
            </div>
            <button className="settings-test-btn" onClick={handleTestAgent} disabled={testingAgent}>
              {testingAgent ? '测试中...' : '测试连接'}
            </button>
          </div>
        </div>
      </div>

      {/* Cross-Machine Sync */}
      <div className="settings-section">
        <div className="settings-section-title">跨机器同步</div>
        <div className="settings-card">
          <div className="settings-card-body">
            <div className="settings-field" style={{ marginBottom: 12 }}>
              <label>同步密码</label>
              <input type="password" className="settings-input" placeholder="所有机器输入相同密码即可同步"
                value={syncPassword} onChange={e => { setSyncPassword(e.target.value); }}
                onBlur={() => { if (syncPassword) saveAll(undefined, undefined, undefined, syncPassword); }} />
            </div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>本机 ID</div>
                <div style={{ fontSize: 12, fontFamily: 'Courier New, monospace', color: 'var(--ink-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{syncStatus?.machineId || '未生成'}</span>
                  {syncStatus?.machineId && (
                    <button className="settings-vault-new-btn" style={{ width: 24, height: 24 }} onClick={() => { navigator.clipboard.writeText(syncStatus.machineId!); showToast('已复制'); }} title="复制">
                      <svg width="10" height="10" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="5" y="5" width="10" height="10" rx="1.5" /><path d="M3 13V3a1.5 1.5 0 011.5-1.5H13" /></svg>
                    </button>
                  )}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>上次同步</div>
                <div style={{ fontSize: 12, color: 'var(--ink-light)' }}>
                  {syncStatus?.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString('zh-CN') : '从未同步'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="settings-test-btn" onClick={handlePushSync} disabled={!!syncing} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {syncing === 'push' ? '推送中...' : '推送本机数据'}
              </button>
              <button className="settings-test-btn" onClick={handlePullSync} disabled={!!syncing} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {syncing === 'pull' ? '拉取中...' : '拉取远端数据'}
              </button>
            </div>
            {syncStatus?.platformId && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-muted)' }}>
                同步平台：{PLATFORM_IDS[syncStatus.platformId] || syncStatus.platformId}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Platform Sync */}
      <div className="settings-section">
        <div className="settings-section-title">同步平台</div>
        <div className="settings-platforms">
          {Object.entries(PLATFORM_FIELDS).map(([platId, fields]) => {
            const plat = platforms[platId] || {};
            const testing = testingPlatform === platId;
            return (
              <div key={platId} className="settings-plat-card">
                <div className="settings-plat-header">
                  <div className="settings-plat-info">
                    <div className="settings-plat-name">{platId}</div>
                    <div className="settings-plat-status">{plat.enabled ? '已启用' : '未配置'}</div>
                  </div>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={!!plat.enabled} onChange={e => { updatePlatform(platId, 'enabled', e.target.checked); }} />
                    <span className="settings-toggle-slider" />
                  </label>
                </div>
                <div className="settings-plat-body">
                  {fields.map(field => (
                    <div key={field} className="settings-field">
                      <label>{field}</label>
                      <input type={field.includes('ecret') || field.includes('oken') || field.includes('Key') ? 'password' : 'text'}
                        className="settings-input" value={plat[field] || ''} placeholder={field}
                        onChange={e => updatePlatform(platId, field, e.target.value)} />
                    </div>
                  ))}
                  <button className="settings-test-btn" onClick={() => handleTestPlatform(platId)} disabled={testing}>
                    {testing ? '测试中...' : '测试连接'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Vault Quick Add Modal */}
      {vaultFormVisible && (
        <div className="auth-overlay" style={{ display: '' }}>
          <div className="confirm-panel" style={{ maxWidth: 400, textAlign: 'left' }}>
            <div className="progress-header">
              <span className="progress-title">添加密钥</span>
              <button className="progress-close" onClick={() => setVaultFormVisible(false)}>&times;</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div className="settings-field" style={{ marginBottom: 8 }}>
                <label>Key</label>
                <input type="text" className="settings-input" placeholder="例如 OPENAI_API_KEY" value={vaultFormKey} onChange={e => setVaultFormKey(e.target.value)} />
              </div>
              <div className="settings-field" style={{ marginBottom: 8 }}>
                <label>Value</label>
                <input type="password" className="settings-input" placeholder="密钥值" value={vaultFormValue} onChange={e => setVaultFormValue(e.target.value)} />
              </div>
              <div className="settings-field">
                <label>分组</label>
                <input type="text" className="settings-input" placeholder="可选" value={vaultFormGroup} onChange={e => setVaultFormGroup(e.target.value)} />
              </div>
            </div>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn--cancel" onClick={() => setVaultFormVisible(false)}>取消</button>
              <button className="confirm-btn confirm-btn--ok" onClick={saveVaultQuick}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
