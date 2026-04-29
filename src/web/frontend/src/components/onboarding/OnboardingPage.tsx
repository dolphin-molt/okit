import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getOnboarding, getPresets, dismissOnboarding, resetOnboarding } from '../../api/settings';
import { setVault } from '../../api/vault';
import { executeAction } from '../../api/tools';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

interface PresetKey {
  key: string;
  label: string;
  hint: string;
}

interface Preset {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  tools: string[];
  requiredKeys: PresetKey[];
}

export default function OnboardingPage() {
  const { showToast, setConnectionStatus } = useApp();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState('');

  useEffect(() => { check(); }, []);

  async function check() {
    try {
      const [onboardData, presetData] = await Promise.all([getOnboarding(), getPresets()]);
      const p = (presetData as any).presets || [];
      setPresets(p);
      if ((onboardData as any).done || p.length === 0) {
        setDismissed(true);
      }
      setConnectionStatus('connected');
    } catch { setConnectionStatus('error'); }
  }

  function selectPreset(preset: Preset) {
    setSelectedPreset(preset);
    setKeyValues({});
    setProgress('');
  }

  async function executePreset() {
    if (!selectedPreset) return;
    // Validate required keys
    for (const k of selectedPreset.requiredKeys) {
      if (!keyValues[k.key]?.trim()) {
        showToast(t('onboarding.fillAll'), 'error');
        return;
      }
    }

    setExecuting(true);
    setProgress(t('onboarding.configuring'));

    // 1. Save keys to vault
    let keysOk = 0;
    for (const k of selectedPreset.requiredKeys) {
      try {
        const res = await setVault({ key: k.key, alias: 'default', value: keyValues[k.key].trim() });
        if ((res as any).success) keysOk++;
      } catch {}
    }

    // 2. Install tools sequentially
    let toolsOk = 0;
    for (const toolName of selectedPreset.tools) {
      try {
        for await (const event of executeAction(toolName, 'install')) {
          if (event.type === 'output') setProgress(prev => prev + event.message + '\n');
          if (event.type === 'success') toolsOk++;
        }
      } catch {}
    }

    setExecuting(false);
    setSelectedPreset(null);
    await dismissOnboardingAction();
    showToast(t('onboarding.result', { tools: toolsOk, keys: keysOk }));
    navigate('/tools');
  }

  async function dismissOnboardingAction() {
    try { await dismissOnboarding(); } catch {}
    setDismissed(true);
  }

  async function handleReset() {
    try { await resetOnboarding(); } catch {}
    setDismissed(false);
    check();
  }

  if (dismissed) {
    return (
      <div>
        <div id="quickStartEmpty" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 48, opacity: 0.15, marginBottom: 16 }}>&#10003;</div>
          <p style={{ color: 'var(--ink-muted)', marginBottom: 16 }}>{t('onboarding.completed')}</p>
          <button className="btn-action" onClick={handleReset} style={{ fontSize: 13, padding: '8px 20px' }}>{t('onboarding.reconfigure')}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Preset cards */}
      <div className="quick-start-cards" id="quickStartCards">
        {presets.map(p => (
          <div
            key={p.id}
            className="quick-start-card"
            style={{ borderLeft: '3px solid var(--ink-muted)' }}
            onClick={() => selectPreset(p)}
          >
            <div className="quick-start-card-icon">{p.icon}</div>
            <div className="quick-start-card-name">{p.name}</div>
            <div className="quick-start-card-desc">{p.desc}</div>
            <div className="quick-start-card-meta">
              <span>{t('onboarding.toolsCount', { n: p.tools.length })}</span>
              <span>{t('onboarding.keysCount', { n: p.requiredKeys.length })}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 24 }}>
        <button className="btn-outline" onClick={dismissOnboardingAction} style={{ fontSize: 12, opacity: 0.6 }}>{t('onboarding.skip')}</button>
      </div>

      {/* Preset modal */}
      {selectedPreset && (
        <div className="auth-overlay" style={{ display: '' }}>
          <div className="preset-panel">
            <div className="progress-header">
              <span className="progress-title">{selectedPreset.name}</span>
              <button className="progress-close" onClick={() => setSelectedPreset(null)}>&times;</button>
            </div>
            <div className="preset-body">
              <div className="preset-tools-preview">
                {selectedPreset.tools.map(t => (
                  <span key={t} className="preset-tool-tag">{t}</span>
                ))}
                <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{t('onboarding.willInstall')}</span>
              </div>
              {selectedPreset.requiredKeys.map(k => (
                <div key={k.key} className="settings-field" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <label style={{ minWidth: 'auto', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{k.label}</label>
                  <input
                    type="password"
                    className="settings-input preset-key-input"
                    style={{ width: '100%' }}
                    placeholder={k.hint}
                    value={keyValues[k.key] || ''}
                    onChange={e => setKeyValues(prev => ({ ...prev, [k.key]: e.target.value }))}
                  />
                  <div className="preset-key-hint">{k.hint}</div>
                </div>
              ))}
              {progress && (
                <pre className="progress-output" style={{ maxHeight: 120, fontSize: 11, overflow: 'auto' }}>{progress}</pre>
              )}
            </div>
            <div className="preset-footer">
              <button className="btn-cancel" onClick={() => setSelectedPreset(null)} disabled={executing}>{t('common.cancel')}</button>
              <button className="btn-save" onClick={executePreset} disabled={executing}>
                {executing ? t('onboarding.configuring2') : t('onboarding.oneClick')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
