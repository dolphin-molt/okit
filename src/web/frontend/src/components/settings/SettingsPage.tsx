import React, { useEffect, useRef, useState } from 'react';
import { getSettings, updateSettings, testPlatform, testAgent } from '../../api/settings';
import { listVault } from '../../api/vault';
import { pushSync, pullSync, getSyncStatus, exportSyncCode, importSyncCode } from '../../api/sync';
import { listProviders, type Provider } from '../../api/providers';
import { PLATFORM_FIELDS, PLATFORM_IDS, PLATFORM_DOCS } from '../../lib/constants';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import VaultFormModal from '../shared/VaultFormModal';
import VaultPickerModal from '../shared/VaultPickerModal';
import CustomSelect from '../shared/CustomSelect';

const DEFAULT_AGENT = { provider: 'siliconflow', model: '', baseUrl: '', apiKeyVaultKey: '' };
const VAULT_REF_FIELDS = new Set([
  'apiToken',
  'storeId',
  'projectId',
  'apiKey',
  'accountId',
  'r2AccessKeyId',
  'r2SecretAccessKey',
  'accessKey',
  'secretKey',
]);

export default function SettingsPage() {
  const { showToast, setConnectionStatus, theme, setThemeMode } = useApp() as any;
  const { t } = useI18n();
  const [autoSync, setAutoSync] = useState(false);
  const [agent, setAgent] = useState(DEFAULT_AGENT);
  const [platforms, setPlatforms] = useState<Record<string, any>>({});
  const [modelProviders, setModelProviders] = useState<Provider[]>([]);
  const [vaultKeys, setVaultKeys] = useState<string[]>([]);
  const [testingPlatform, setTestingPlatform] = useState<string | null>(null);
  const [testingAgent, setTestingAgent] = useState(false);
  const [vaultFormVisible, setVaultFormVisible] = useState(false);
  const [syncPassword, setSyncPassword] = useState('');
  const syncFileInputRef = useRef<HTMLInputElement | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ machineId: string | null; lastSyncAt: string | null; platformId: string | null; hasPassword: boolean } | null>(null);
  const [syncing, setSyncing] = useState<'push' | 'pull' | null>(null);
  const [syncCodeBusy, setSyncCodeBusy] = useState<'export' | 'import' | null>(null);
  const [docPlatform, setDocPlatform] = useState<string | null>(null);
  const [vaultTarget, setVaultTarget] = useState<{ platId: string; field: string } | null>(null);
  const [showVaultPicker, setShowVaultPicker] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [settingsData, vaultData, status, providersData] = await Promise.all([getSettings(), listVault(), getSyncStatus(), listProviders()]);
      const s = settingsData as any;
      const providers = providersData.providers || [];
      setModelProviders(providers);
      setAutoSync(!!s.sync?.autoSync);
      if (s.sync?.password && s.sync.password !== '***') {
        setSyncPassword(s.sync.password);
      }
      if (s.agent) {
        const normalizedAgent = { ...DEFAULT_AGENT, ...s.agent };
        setAgent(normalizedAgent);
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
    } catch { showToast(t('settings.saveFail'), 'error'); }
  }

  // Agent settings handlers
  function onProviderChange(provider: string) {
    const selected = modelProviders.find(p => p.id === provider);
    if (!selected) return;
    const primaryEndpoint = selected.endpoints?.[0] || { type: selected.type, baseUrl: selected.baseUrl };
    const newAgent = {
      ...DEFAULT_AGENT,
      ...agent,
      provider,
      baseUrl: primaryEndpoint.baseUrl || selected.baseUrl || '',
      apiKeyVaultKey: selected.vaultKey || '',
      model: selected.models?.[0]?.id || '',
    };
    setAgent(newAgent);
    saveAll(newAgent);
  }

  async function handleTestAgent() {
    setTestingAgent(true);
    await saveAll();
    try {
      const data = await testAgent();
      showToast(data.message || (data.success ? t('settings.connSuccess') : t('settings.connFail')), data.success ? 'success' : 'error');
    } catch { showToast(t('settings.testConnFail'), 'error'); } finally { setTestingAgent(false); }
  }

  // Sync handlers
  async function handlePushSync() {
    if (!syncPassword && !syncStatus?.hasPassword) { showToast(t('settings.setSyncPwd'), 'error'); return; }
    setSyncing('push');
    try {
      const data = await pushSync();
      if (data.success) {
        showToast(t('settings.pushSuccess', { n: data.secrets || 0 }));
        const status = await getSyncStatus();
        setSyncStatus(status as any);
      } else {
        showToast(data.message || t('settings.pushFail'), 'error');
      }
    } catch { showToast(t('settings.pushFail'), 'error'); } finally { setSyncing(null); }
  }

  async function handlePullSync() {
    if (!syncPassword && !syncStatus?.hasPassword) { showToast(t('settings.setSyncPwd'), 'error'); return; }
    setSyncing('pull');
    try {
      const data = await pullSync();
      if (data.success) {
        showToast(t('settings.pullSuccess', { added: data.added || 0, updated: data.updated || 0, providers: data.providers || 0 }));
        loadData();
      } else {
        showToast(data.message || t('settings.pullFail'), 'error');
      }
    } catch { showToast(t('settings.pullFail'), 'error'); } finally { setSyncing(null); }
  }

  async function handleExportSyncCode() {
    if (!syncPassword && !syncStatus?.hasPassword) { showToast(t('settings.setSyncPwd'), 'error'); return; }
    setSyncCodeBusy('export');
    try {
      if (syncPassword) await saveAll(undefined, undefined, undefined, syncPassword);
      const data = await exportSyncCode(syncPassword || undefined);
      const payload = {
        type: 'okit-sync',
        version: 1,
        platform: data.platform,
        secrets: data.secrets || 0,
        exportedAt: new Date().toISOString(),
        code: data.code,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `okit-sync-${data.platform}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showToast(t('settings.syncFileExported', { n: data.secrets || 0 }), 'success');
    } catch (error: any) {
      showToast(error?.message || t('settings.syncFileExportFail'), 'error');
    } finally {
      setSyncCodeBusy(null);
    }
  }

  async function importCodeValue(code: string) {
    const data = await importSyncCode(code, syncPassword);
    showToast(t('settings.syncFileImported', { platform: PLATFORM_IDS[data.platform] || data.platform, n: data.secrets || 0 }), 'success');
    await loadData();
  }

  async function handleImportSyncFile(file?: File) {
    if (!file) return;
    if (!syncPassword) { showToast(t('settings.setSyncPwd'), 'error'); return; }
    setSyncCodeBusy('import');
    try {
      const code = extractSyncCodeFromFile(await file.text());
      if (!code) { showToast(t('settings.syncFileRequired'), 'error'); return; }
      await importCodeValue(code);
    } catch (error: any) {
      showToast(error?.message || t('settings.syncFileImportFail'), 'error');
    } finally {
      setSyncCodeBusy(null);
      if (syncFileInputRef.current) syncFileInputRef.current.value = '';
    }
  }

  function extractSyncCodeFromFile(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return '';
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.type === 'okit-sync' && typeof parsed.code === 'string') return parsed.code;
    } catch {}
    return trimmed;
  }


  // Vault form handlers
  const groups = [...new Set(vaultKeys.map(k => k.split('_')[0]).filter(Boolean))].sort();

  function openVaultAdd() {
    setVaultFormVisible(true);
  }

  function handleVaultSaved(key: string) {
    if (!key) { showToast(t('settings.saveFail'), 'error'); return; }
    showToast(t('settings.keyAdded'));
    setVaultFormVisible(false);
    setVaultKeys(prev => [...prev, key]);
    if (vaultTarget) {
      updatePlatform(vaultTarget.platId, vaultTarget.field, key);
      setVaultTarget(null);
    }
  }

  // Platform settings
  function updatePlatform(id: string, field: string, value: any) {
    const newPlatforms = { ...platforms, [id]: { ...(platforms[id] || {}), [field]: value } };
    setPlatforms(newPlatforms);
    saveAll(undefined, undefined, newPlatforms);
  }

  async function handleTestPlatform(platformId: string) {
    setTestingPlatform(platformId);
    await saveAll();
    try {
      const data = await testPlatform(platformId);
      showToast(data.message || (data.success ? t('settings.connSuccess') : t('settings.connFail')), data.success ? 'success' : 'error');
    } catch { showToast(t('settings.testConnFail'), 'error'); } finally { setTestingPlatform(null); }
  }

  const currentProvider = modelProviders.find(p => p.id === agent.provider);
  const platformEntries = Object.entries(PLATFORM_FIELDS);
  const enabledPlatformCount = Object.values(platforms).filter((p: any) => p?.enabled).length;
  const syncReady = !!syncStatus?.platformId && !!syncStatus?.hasPassword;

  return (
    <div className={`access-workspace settings-workspace settings-workspace--${theme}`}>
      <header className="access-hero settings-hero">
        <div className="access-hero-copy">
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.lede')}</p>
        </div>
        <div className="access-hero-stats" aria-label="Settings summary">
          <div><span>{t('settings.enabledPlatforms')}</span><strong>{enabledPlatformCount}</strong></div>
          <div><span>{t('settings.vaultKeys')}</span><strong>{vaultKeys.length}</strong></div>
          <div><span>{t('settings.agentProvider')}</span><strong>{currentProvider?.name || agent.provider || '-'}</strong></div>
          <div><span>{t('common.sync')}</span><strong>{syncReady ? t('settings.syncReady') : t('settings.syncOff')}</strong></div>
        </div>
      </header>

      {/* Appearance */}
      <div className="settings-section settings-section--top">
        <div className="settings-section-title">{t('settings.appearance')}</div>
        <div className="settings-card">
          <div className="settings-card-body">
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">{t('settings.themeMode')}</div>
                <div className="settings-row-desc">{t('settings.darkModeDesc')}</div>
              </div>
              <div className="settings-theme-switch" role="group" aria-label={t('settings.themeMode')}>
                <button
                  type="button"
                  className={theme === 'dark' ? 'active' : ''}
                  onClick={() => setThemeMode('dark')}
                >
                  {t('settings.themeDark')}
                </button>
                <button
                  type="button"
                  className={theme === 'light' ? 'active' : ''}
                  onClick={() => setThemeMode('light')}
                >
                  {t('settings.themeLight')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Auto Sync Toggle */}
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.access')}</div>
        <div className="settings-card">
          <div className="settings-card-body">
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">{t('settings.autoSync')}</div>
                <div className="settings-row-desc">{t('settings.autoSyncDesc')}</div>
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
        <div className="settings-section-title">{t('settings.aiAssistant')}</div>
        <div className="settings-card">
          <div className="settings-card-body settings-card-body--agent">
            <div className="settings-field">
              <label>{t('settings.provider')}</label>
              <CustomSelect
                className="settings-select-wrap"
                value={agent.provider}
                onChange={onProviderChange}
                options={modelProviders.map(p => ({ value: p.id, label: p.name }))}
              />
            </div>
            <button className="settings-test-btn" onClick={handleTestAgent} disabled={testingAgent}>
              {testingAgent ? t('common.testing') : t('common.test')}
            </button>
          </div>
        </div>
      </div>

      {/* Cross-Machine Sync */}
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.crossSync')}</div>
        <div className="settings-card">
          <div className="settings-card-body settings-card-body--sync">
            <div className="settings-sync-grid">
            <div className="settings-field settings-field--quiet settings-field--prototype">
              <label>{t('settings.syncPassword')}</label>
              <input type="password" className="settings-input" placeholder={syncStatus?.hasPassword ? t('settings.syncPasswordSavedDesc') : t('settings.syncPasswordDesc')}
                value={syncPassword} onChange={e => { setSyncPassword(e.target.value); }}
                onBlur={() => { if (syncPassword) saveAll(undefined, undefined, undefined, syncPassword); }} />
            </div>
            <div className="settings-field settings-field--quiet settings-field--quiet-select">
              <label>{t('settings.syncPlatform')}</label>
              <CustomSelect
                className="settings-select-wrap"
                value={syncStatus?.platformId || ''}
                onChange={v => { updateSettings({ sync: { syncPlatform: v } }).then(() => loadData()); }}
                placeholder={t('settings.selectSyncPlatform')}
                options={Object.entries(platforms).filter(([, p]: any) => p.enabled).map(([id]: any) => ({ value: id, label: PLATFORM_IDS[id] || id }))}
              />
            </div>
            </div>
            <div className="settings-sync-meta">
              <div className="settings-meta-field">
                <label>{t('settings.machineId')}</label>
                <div className="settings-meta-value settings-meta-value--mono">
                  <span>{syncStatus?.machineId || t('settings.notGenerated')}</span>
                  {syncStatus?.machineId && (
                    <button className="settings-vault-new-btn settings-meta-copy" onClick={() => { navigator.clipboard.writeText(syncStatus.machineId!); showToast(t('common.copied')); }} title={t('vault.copy')}>
                      <svg width="10" height="10" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="5" y="5" width="10" height="10" rx="1.5" /><path d="M3 13V3a1.5 1.5 0 011.5-1.5H13" /></svg>
                    </button>
                  )}
                </div>
              </div>
              <div className="settings-meta-field">
                <label>{t('settings.lastSync')}</label>
                <div className="settings-meta-value">
                  {syncStatus?.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString('zh-CN') : t('settings.neverSynced')}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="settings-test-btn" onClick={handlePushSync} disabled={!!syncing} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {syncing === 'push' ? t('settings.pushing') : t('settings.pushLocal')}
              </button>
              <button className="settings-test-btn" onClick={handlePullSync} disabled={!!syncing} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {syncing === 'pull' ? t('settings.pulling') : t('settings.pullRemote')}
              </button>
              <input
                ref={syncFileInputRef}
                type="file"
                accept=".json,.okit-sync,application/json,text/plain"
                style={{ display: 'none' }}
                onChange={e => handleImportSyncFile(e.target.files?.[0])}
              />
              <button className="settings-test-btn" onClick={() => syncFileInputRef.current?.click()} disabled={!!syncCodeBusy}>
                {syncCodeBusy === 'import' ? t('settings.importingSyncFile') : t('settings.importSyncFile')}
              </button>
              <button className="settings-test-btn" onClick={handleExportSyncCode} disabled={!!syncCodeBusy}>
                {syncCodeBusy === 'export' ? t('settings.exportingSyncFile') : t('settings.exportSyncFile')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Platform Sync */}
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.syncPlatformTitle')}</div>
        <div className="settings-platforms">
          {platformEntries.map(([platId, fields]) => {
            const plat = platforms[platId] || {};
            const testing = testingPlatform === platId;
            return (
              <div key={platId} className="settings-plat-card">
                <div className="settings-plat-header">
                  <div className="settings-plat-info">
                    <div className="settings-plat-name">
                      {PLATFORM_IDS[platId] || platId}
                      <button className="settings-doc-btn" onClick={() => setDocPlatform(platId)} title={t('settings.configDocs')}>
                        <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 2h7l4 4v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 014 15V3.5A1.5 1.5 0 015.5 2z" />
                          <path d="M11 2v4h4" />
                          <path d="M7 10h4M7 13h3" />
                        </svg>
                      </button>
                    </div>
                    <div className="settings-plat-status">{plat.enabled ? t('common.enabled') : t('common.notConfigured')}</div>
                  </div>
                  <div className="settings-plat-actions">
                    <button
                      type="button"
                      className={`settings-icon-btn settings-icon-btn--test${testing ? ' is-loading' : ''}`}
                      onClick={() => handleTestPlatform(platId)}
                      disabled={testing}
                      title={testing ? t('common.testing') : t('common.test')}
                      aria-label={testing ? t('common.testing') : t('common.test')}
                    >
                      <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5.5 2.5v4M12.5 2.5v4" />
                        <path d="M4 6.5h10v2.8a5 5 0 0 1-10 0V6.5z" />
                        <path d="M9 14.3V16" />
                      </svg>
                    </button>
                    <label className="settings-toggle">
                      <input type="checkbox" checked={!!plat.enabled} onChange={e => { updatePlatform(platId, 'enabled', e.target.checked); }} />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                </div>
                <div className="settings-plat-body">
                  {fields.map(field => {
                    const isSecret = VAULT_REF_FIELDS.has(field) || (/ecret|oken|Key|Id$/i.test(field) && !/databaseId|bucketName|region/i.test(field));
                    return (
                      <div key={field} className={`settings-field${isSecret ? ' settings-field--secret' : ''}`}>
                        <label>{field}</label>
                        {isSecret ? (
                          <div className="vault-ref-field">
                            {plat[field] ? (
                              <div className="vault-ref-selected">
                                <span className="vault-ref-key">{plat[field]}</span>
                                <button type="button" className="vault-ref-clear" onClick={() => updatePlatform(platId, field, '')}>×</button>
                                <button type="button" className="vault-ref-change" onClick={() => { setVaultTarget({ platId, field }); setShowVaultPicker(true); }}>{t('common.replace')}</button>
                              </div>
                            ) : (
                              <button type="button" className="vault-ref-trigger" onClick={() => { setVaultTarget({ platId, field }); setShowVaultPicker(true); }}>{t('tools.selectFromVault')}</button>
                            )}
                          </div>
                        ) : (
                          <input type="text" className="settings-input" value={plat[field] || ''} placeholder={field}
                            onChange={e => updatePlatform(platId, field, e.target.value)} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Vault Quick Add Modal */}
      {vaultFormVisible && (
        <VaultFormModal
          groups={groups}
          onClose={() => { setVaultFormVisible(false); setVaultTarget(null); }}
          onSaved={handleVaultSaved}
        />
      )}

      {/* Vault Picker Modal */}
      {showVaultPicker && (
        <VaultPickerModal
          selected={vaultTarget ? platforms[vaultTarget.platId]?.[vaultTarget.field] || '' : ''}
          onSelect={key => {
            if (vaultTarget) {
              updatePlatform(vaultTarget.platId, vaultTarget.field, key);
            }
            setShowVaultPicker(false);
          }}
          onClose={() => { setShowVaultPicker(false); setVaultTarget(null); }}
        />
      )}

      {/* Platform Doc Modal */}
      {docPlatform && PLATFORM_DOCS[docPlatform] && (() => {
        const doc = PLATFORM_DOCS[docPlatform];
        function renderStep(text: string, links?: Record<string, string>) {
          if (!links) return text;
          let parts: (string | React.ReactNode)[] = [text];
          for (const [label, url] of Object.entries(links)) {
            const next: (string | React.ReactNode)[] = [];
            for (const part of parts) {
              if (typeof part !== 'string') { next.push(part); continue; }
              const idx = part.indexOf(label);
              if (idx < 0) { next.push(part); continue; }
              next.push(part.slice(0, idx));
              next.push(<a key={label} href={url} target="_blank" rel="noopener noreferrer" className="platdoc-inline-link">{label}</a>);
              next.push(part.slice(idx + label.length));
            }
            parts = next;
          }
          return parts;
        }
        return (
          <div className="auth-overlay" style={{ display: '' }}>
            <div className="confirm-panel platdoc-panel" style={{ maxWidth: 680, textAlign: 'left' }}>
              <div className="progress-header">
                <span className="progress-title">{t('settings.configGuide', { platform: PLATFORM_IDS[docPlatform] || docPlatform })}</span>
                <button className="progress-close" onClick={() => setDocPlatform(null)}>&times;</button>
              </div>
              <div className="platdoc-body">
                <div className="platdoc-section">
                  <div className="platdoc-section-title">{t('settings.configSteps')}</div>
                  <ol className="platdoc-steps">
                    {doc.steps.map((step, i) => <li key={i}>{renderStep(step.text, step.links)}</li>)}
                  </ol>
                </div>
                <div className="platdoc-section">
                  <div className="platdoc-section-title">{t('settings.fieldDesc')}</div>
                  <div className="platdoc-fields">
                    {Object.entries(doc.fields).map(([key, f]) => (
                      <div key={key} className="platdoc-field">
                        <span className="platdoc-field-label">{f.label}</span>
                        <span className="platdoc-field-hint">{f.hint}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {doc.code && (
                  <div className="platdoc-section">
                    <div className="platdoc-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{doc.code.title}</span>
                      <button className="settings-vault-new-btn" style={{ width: 56, fontSize: 11 }} onClick={() => { navigator.clipboard.writeText(doc.code!.sql); showToast(t('settings.sqlCopied')); }}>{t('vault.copy')}</button>
                    </div>
                    <pre className="platdoc-code">{doc.code.sql}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
