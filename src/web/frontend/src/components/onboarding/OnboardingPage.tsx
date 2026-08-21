import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getOnboarding, getPresets, dismissOnboarding, resetOnboarding } from '../../api/settings';
import { setVault } from '../../api/vault';
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
  const presetPanelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const executingRef = useRef(executing);

  useEffect(() => { check(); }, []);

  useEffect(() => { executingRef.current = executing; }, [executing]);

  useEffect(() => {
    if (!selectedPreset) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = presetPanelRef.current;
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || []);
    (panel?.querySelector<HTMLElement>('input:not(:disabled)') || focusable()[0])?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !executingRef.current) {
        event.preventDefault();
        setSelectedPreset(null);
      }
      if (event.key === 'Tab') {
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [selectedPreset]);

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
        const res = await setVault({ key: k.key, value: keyValues[k.key].trim() });
        if ((res as any).success) keysOk++;
      } catch {}
    }

    setExecuting(false);
    setSelectedPreset(null);
    await dismissOnboardingAction();
    showToast(t('onboarding.result', { keys: keysOk }));
    navigate('/');
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
      <main className="onboarding-page">
        <div id="quickStartEmpty" className="onboarding-complete">
          <div style={{ fontSize: 48, opacity: 0.15, marginBottom: 16 }}>&#10003;</div>
          <h1>{t('onboarding.completed')}</h1>
          <button className="btn-action" onClick={handleReset} style={{ fontSize: 13, padding: '8px 20px' }}>{t('onboarding.reconfigure')}</button>
        </div>
      </main>
    );
  }

  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <span>{t('onboarding.choosePreset')}</span>
        <h1>{t('onboarding.title')}</h1>
        <p>{t('onboarding.subtitle')}</p>
      </header>
      {/* Preset cards */}
      <div className="quick-start-cards" id="quickStartCards">
        {presets.map(p => (
          <button
            type="button"
            key={p.id}
            className="quick-start-card"
            style={{ borderLeft: '3px solid var(--ink-muted)' }}
            onClick={() => selectPreset(p)}
          >
            <div className="quick-start-card-icon">{p.icon}</div>
            <div className="quick-start-card-name">{p.name}</div>
            <div className="quick-start-card-desc">{p.desc}</div>
            <div className="quick-start-card-meta">
              <span>{t('onboarding.keysCount', { n: p.requiredKeys.length })}</span>
            </div>
          </button>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 24 }}>
        <button className="onboarding-skip" onClick={dismissOnboardingAction}>{t('onboarding.skip')}</button>
      </div>

      {/* Preset modal */}
      {selectedPreset && (
        <div className="auth-overlay" style={{ display: '' }} onMouseDown={event => { if (event.target === event.currentTarget && !executing) setSelectedPreset(null); }}>
          <div
            ref={presetPanelRef}
            className="preset-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preset-dialog-title"
          >
            <div className="progress-header">
              <span className="progress-title" id="preset-dialog-title">{selectedPreset.name}</span>
              <button className="progress-close" onClick={() => setSelectedPreset(null)} aria-label={t('common.close')} disabled={executing}>&times;</button>
            </div>
            <div className="preset-body">
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
    </main>
  );
}
