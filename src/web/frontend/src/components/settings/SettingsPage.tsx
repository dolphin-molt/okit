import React, { useEffect, useState } from 'react';
import { getSettings, updateSettings, testAgent } from '../../api/settings';
import { listProviders, type Provider } from '../../api/providers';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import CustomSelect from '../shared/CustomSelect';
import LogsPage from '../logs/LogsPage';
import DeviceSyncSection from './DeviceSyncSection';

const DEFAULT_AGENT = { provider: 'siliconflow', model: '', baseUrl: '', apiKeyVaultKey: '' };

export default function SettingsPage() {
  const { showToast, setConnectionStatus, theme, setThemeMode } = useApp() as any;
  const { t } = useI18n();
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

  return (
    <div className={`access-workspace settings-workspace settings-workspace--${theme}`}>
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

      {/* Device Sync — merged section (password, devices, LAN pairing, cloud backup, manual ops) */}
      <DeviceSyncSection />

      {/* Support diagnostics */}
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.diagnostics')}</div>
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
    </div>
  );
}
