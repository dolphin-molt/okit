import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSettings, updateSettings, testAgent } from '../../api/settings';
import { listProviders, type Provider } from '../../api/providers';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import CustomSelect from '../shared/CustomSelect';
import LogsPage from '../logs/LogsPage';
import DeviceSyncSection from './DeviceSyncSection';
import SnapshotsSection from './SnapshotsSection';

const DEFAULT_AGENT = { provider: 'siliconflow', model: '', baseUrl: '', apiKeyVaultKey: '' };

/* 界面风格包：id 对应 <html data-style>，swatch 为 [暗色面板色, 强调色, 亮色面板色] */
const UI_STYLES = [
  { id: 'command', nameKey: 'settings.styleCommand', swatch: ['#101512', '#efff61', '#fbfaf5'] },
  { id: 'kraft', nameKey: 'settings.styleKraft', swatch: ['#1a1510', '#e6a23c', '#faf6ee'] },
  { id: 'ocean', nameKey: 'settings.styleOcean', swatch: ['#0d1524', '#38bdf8', '#f6f9fd'] },
  { id: 'mono', nameKey: 'settings.styleMono', swatch: ['#131313', '#f4f4f3', '#f8f8f7'] },
  { id: 'ember', nameKey: 'settings.styleEmber', swatch: ['#191210', '#fb923c', '#fbf6f2'] },
];

export default function SettingsPage() {
  const { showToast, setConnectionStatus, theme, setThemeMode, uiStyle, setUiStyle } = useApp() as any;
  const { t, lang, setLang } = useI18n();
  const [agent, setAgent] = useState(DEFAULT_AGENT);
  const [modelProviders, setModelProviders] = useState<Provider[]>([]);
  const [testingAgent, setTestingAgent] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [settingsData, providersData] = await Promise.all([getSettings(), listProviders()]);
      const s = settingsData as any;
      setModelProviders(providersData.providers || []);
      if (s.agent) {
        setAgent({ ...DEFAULT_AGENT, ...s.agent });
      }
      setConnectionStatus('connected');
    } catch { setConnectionStatus('error'); }
  }

  async function saveAgent(newAgent: typeof agent) {
    try {
      await updateSettings({ agent: newAgent });
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
    saveAgent(newAgent);
  }

  async function handleTestAgent() {
    setTestingAgent(true);
    await saveAgent(agent);
    try {
      const data = await testAgent();
      showToast(data.message || (data.success ? t('settings.connSuccess') : t('settings.connFail')), data.success ? 'success' : 'error');
    } catch { showToast(t('settings.testConnFail'), 'error'); } finally { setTestingAgent(false); }
  }

  const [searchParams] = useSearchParams();
  const rawSection = searchParams.get('section') || 'appearance';
  const section = ['appearance', 'agent', 'sync', 'snapshots', 'diagnostics'].includes(rawSection) ? rawSection : 'appearance';

  return (
    <div className={`access-workspace settings-workspace settings-workspace--${theme}`}>
      {/* Appearance */}
      {section === 'appearance' && (
      <div className="settings-section settings-section--top" id="appearance">
        <div className="settings-block">
          <div className="settings-block-title">{t('settings.themeMode')}</div>
          <div className="settings-card">
            <div className="settings-card-body">
              <div className="settings-mode-grid" role="group" aria-label={t('settings.themeMode')}>
                <button
                  type="button"
                  className={`settings-mode-option${theme === 'dark' ? ' active' : ''}`}
                  onClick={() => setThemeMode('dark')}
                  aria-pressed={theme === 'dark'}
                >
                  <span className="settings-mode-preview settings-mode-preview--dark">
                    <span className="settings-mode-canvas">
                      <span className="settings-mode-dot" />
                    </span>
                    <span className="settings-mode-panel" />
                  </span>
                  <span className="settings-mode-name">{t('settings.themeDark')}</span>
                </button>
                <button
                  type="button"
                  className={`settings-mode-option${theme === 'light' ? ' active' : ''}`}
                  onClick={() => setThemeMode('light')}
                  aria-pressed={theme === 'light'}
                >
                  <span className="settings-mode-preview settings-mode-preview--light">
                    <span className="settings-mode-canvas">
                      <span className="settings-mode-dot" />
                    </span>
                    <span className="settings-mode-panel" />
                  </span>
                  <span className="settings-mode-name">{t('settings.themeLight')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-block">
          <div className="settings-block-title">{t('settings.language')}</div>
          <div className="settings-card">
            <div className="settings-card-body">
              <div className="settings-mode-grid settings-mode-grid--lang" role="group" aria-label={t('settings.language')}>
                <button
                  type="button"
                  className={`settings-mode-option settings-mode-option--text${lang === 'zh' ? ' active' : ''}`}
                  onClick={() => setLang('zh')}
                  aria-pressed={lang === 'zh'}
                >
                  <span className="settings-mode-name">中文</span>
                </button>
                <button
                  type="button"
                  className={`settings-mode-option settings-mode-option--text${lang === 'en' ? ' active' : ''}`}
                  onClick={() => setLang('en')}
                  aria-pressed={lang === 'en'}
                >
                  <span className="settings-mode-name">English</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-block">
          <div className="settings-block-title">{t('settings.uiStyle')}</div>
          <div className="settings-card">
            <div className="settings-card-body">
              <div className="settings-style-grid" role="group" aria-label={t('settings.uiStyle')}>
                {UI_STYLES.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={`settings-style-option${uiStyle === s.id ? ' active' : ''}`}
                    onClick={() => setUiStyle(s.id)}
                    aria-pressed={uiStyle === s.id}
                  >
                    <span className="settings-style-preview">
                      <span className="settings-style-preview-half" style={{ background: s.swatch[0] }}>
                        <span className="settings-dot" style={{ background: s.swatch[1] }} />
                      </span>
                      <span className="settings-style-preview-half" style={{ background: s.swatch[2] }} />
                    </span>
                    <span className="settings-style-name">{t(s.nameKey)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Agent Settings */}
      {section === 'agent' && (
      <div className="settings-section" id="agent">
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
      )}

      {/* Device Sync — merged section (password, devices, LAN pairing, cloud backup, manual ops) */}
      {section === 'sync' && (
      <div id="sync" className="settings-section-wrap">
        <DeviceSyncSection />
      </div>
      )}

      {/* Config Snapshots */}
      {section === 'snapshots' && (
      <div className="settings-section" id="snapshots">
        <SnapshotsSection />
      </div>
      )}

      {/* Support diagnostics */}
      {section === 'diagnostics' && (
      <div className="settings-section" id="diagnostics">
        <div className="settings-card settings-logs-card">
          <div className="settings-card-body">
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">{t('settings.logsTitle')}</div>
                <div className="settings-row-desc">{t('settings.logsDesc')}</div>
              </div>
              <button className="settings-test-btn" type="button" onClick={() => setShowLogs(value => !value)}>
                {showLogs ? t('settings.hideLogs') : t('settings.viewLogs')}
              </button>
            </div>
          </div>
          {showLogs && (
            <div className="settings-logs-panel">
              <LogsPage embedded />
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
