import React, { useEffect, useState } from 'react';
import { getSettings, updateSettings, testPlatform } from '../../api/settings';
import { listVault } from '../../api/vault';
import {
  getSyncOverview, enableLanSync, disableLanSync, regenerateLanToken, pairLanDevice, createLanPairing, getLanPairing,
  type SyncOverview, type LanPairingSession,
} from '../../api/sync';
import { PLATFORM_FIELDS, PLATFORM_IDS, PLATFORM_DOCS } from '../../lib/constants';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import VaultFormModal from '../shared/VaultFormModal';
import VaultPickerModal from '../shared/VaultPickerModal';
import CustomSelect from '../shared/CustomSelect';

const VAULT_REF_FIELDS = new Set([
  'apiToken',
  'storeId',
  'projectId',
  'apiKey',
  'r2AccessKeyId',
  'r2SecretAccessKey',
  'accessKey',
  'secretKey',
]);
// Secret-looking fields that hold a literal value (the lan pairing token),
// not a vault reference — render as plain inputs instead of the vault picker.
const PLAIN_SECRET_FIELDS = new Set(['token']);

function lastSeenLabel(iso: string, t: (key: string, params?: any) => string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t('settings.sync2.lastSeenJustNow');
  if (mins < 60) return t('settings.sync2.lastSeenMin', { n: mins });
  return t('settings.sync2.lastSeenHour', { n: Math.floor(mins / 60) });
}

export default function DeviceSyncSection() {
  const { showToast, confirm } = useApp() as any;
  const { t } = useI18n();

  const [overview, setOverview] = useState<SyncOverview | null>(null);
  const [platforms, setPlatforms] = useState<Record<string, any>>({});
  const [vaultKeys, setVaultKeys] = useState<string[]>([]);
  const [autoSync, setAutoSync] = useState(false);
  const [syncPassword, setSyncPassword] = useState('');

  // Panels: add-device dialog + collapsibles (collapsed by default)

  // Platform card interactions
  const [testingPlatform, setTestingPlatform] = useState<string | null>(null);
  const [docPlatform, setDocPlatform] = useState<string | null>(null);
  const [vaultTarget, setVaultTarget] = useState<{ platId: string; field: string } | null>(null);
  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [vaultFormVisible, setVaultFormVisible] = useState(false);

  // LAN pairing — everything lives in the add-device dialog (choice → primary
  // generates a code / join pastes one); the section body stays minimal.
  const [lanBusy, setLanBusy] = useState<'enable' | 'pairing' | 'pair' | null>(null);
  const [lanPairCode, setLanPairCode] = useState('');
  const [lanModalOpen, setLanModalOpen] = useState(false);
  const [lanModalStep, setLanModalStep] = useState<'choice' | 'primary' | 'join'>('choice');
  const [pairing, setPairing] = useState<LanPairingSession | null>(null);
  const [pairingDone, setPairingDone] = useState(false);
  const [lanCodeAddress, setLanCodeAddress] = useState('');
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => { loadData(); }, []);

  // Keep the overview (device online status, last sync) fresh.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const data = await getSyncOverview();
        if (!cancelled) setOverview(data);
      } catch { /* server unreachable; keep last known state */ }
      if (!cancelled) timer = setTimeout(tick, 60_000);
    };
    timer = setTimeout(tick, 60_000);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  async function loadData() {
    try {
      const [overviewData, settingsData, vaultData] = await Promise.all([getSyncOverview(), getSettings(), listVault()]);
      setOverview(overviewData);
      const s = settingsData as any;
      setAutoSync(!!s.sync?.autoSync);
      if (s.sync?.password && s.sync.password !== '***') setSyncPassword(s.sync.password);
      setPlatforms(s.sync?.platforms || {});
      setVaultKeys((vaultData.secrets || []).map((sec: any) => sec.key).filter(Boolean));
    } catch { /* surfaced by connection status elsewhere */ }
  }

  async function refreshOverview() {
    try { setOverview(await getSyncOverview()); } catch { /* keep last known state */ }
  }

  async function saveSync(newPlatforms?: typeof platforms, newAutoSync?: boolean, password?: string) {
    try {
      await updateSettings({
        sync: {
          autoSync: newAutoSync !== undefined ? newAutoSync : autoSync,
          platforms: newPlatforms || platforms,
          ...(password ? { password } : {}),
        },
      });
    } catch { showToast(t('settings.saveFail'), 'error'); }
  }

  // --- Password (set-once flow: prominent until set, then in More Actions) ---
  async function savePassword() {
    if (!syncPassword) return;
    await saveSync(undefined, undefined, syncPassword);
    showToast(t('settings.keyAdded'));
    await refreshOverview();
  }

  // --- Devices --------------------------------------------------------------
  async function generatePairing(silent = false) {
    setLanBusy('pairing');
    try {
      const session = await createLanPairing();
      setPairing(session);
      setPairingDone(false);
      setLanCodeAddress('');
    } catch (e: any) {
      if (!silent) showToast(e.message || t('settings.lanPairFail'), 'error');
    } finally { setLanBusy(null); }
  }

  function openLanModal() {
    setLanModalStep('choice');
    setPairingDone(false);
    setLanModalOpen(true);
  }

  function closeLanModal() {
    setLanModalOpen(false);
    setPairing(null);
    setPairingDone(false);
    setLanPairCode('');
  }

  // "Connect existing devices" — this machine is the primary. Enable the
  // listener behind the scenes if needed, then hand out a fresh pairing code.
  async function choosePrimary() {
    setLanModalStep('primary');
    if (overview?.lan.enabled) {
      generatePairing();
      return;
    }
    if (!syncPassword && !overview?.hasPassword) { showToast(t('settings.setSyncPwd'), 'error'); return; }
    setLanBusy('enable');
    try {
      if (syncPassword) await saveSync(undefined, undefined, syncPassword);
      const status = await enableLanSync();
      await Promise.all([refreshOverview(), loadData()]);
      if (!status.running) {
        showToast(status.error || t('settings.lanPairCodeEmpty'), 'error');
        return;
      }
      await generatePairing(true);
    } catch (e: any) {
      showToast(e.message || t('settings.lanEnableFail'), 'error');
    } finally { setLanBusy(null); }
  }

  // Countdown ticker while a pairing session is live in the dialog.
  useEffect(() => {
    if (!lanModalOpen || lanModalStep !== 'primary' || !pairing) return;
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lanModalOpen, lanModalStep, pairing]);

  // Poll the pairing session: once the spoke redeems the code the session is
  // gone — celebrate and close the dialog automatically.
  useEffect(() => {
    if (!lanModalOpen || lanModalStep !== 'primary' || !pairing || pairingDone) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const peek = await getLanPairing();
        if (stopped || peek.active) return;
        stopped = true;
        setPairingDone(true);
        showToast(t('settings.lanPairedSuccess'), 'success');
        await Promise.all([refreshOverview(), loadData()]);
        setTimeout(() => closeLanModal(), 1200);
      } catch { /* transient poll failure; retry next tick */ }
    }, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [lanModalOpen, lanModalStep, pairing, pairingDone]);

  async function handleLanDisable() {
    setLanBusy('enable');
    try {
      await disableLanSync();
      setPairing(null);
      showToast(t('settings.lanDisabled'));
      await Promise.all([refreshOverview(), loadData()]);
    } catch (e: any) {
      showToast(e.message || t('settings.lanEnableFail'), 'error');
    } finally { setLanBusy(null); }
  }

  async function handleLanResetToken() {
    const ok = await confirm(t('settings.lanConfirmResetToken'), { title: t('settings.lanResetToken'), type: 'warning' });
    if (!ok) return;
    try {
      await regenerateLanToken();
      setPairing(null);
      showToast(t('settings.lanTokenRegenerated'));
      await refreshOverview();
    } catch (e: any) {
      showToast(e.message || t('settings.lanResetToken'), 'error');
    }
  }

  async function handleLanPair() {
    const code = lanPairCode.trim();
    if (!code) { showToast(t('settings.lanPairCodeRequired'), 'error'); return; }
    if (!syncPassword && !overview?.hasPassword) { showToast(t('settings.setSyncPwd'), 'error'); return; }
    setLanBusy('pair');
    try {
      if (syncPassword) await saveSync(undefined, undefined, syncPassword);
      const data = await pairLanDevice(code);
      showToast(t('settings.lanPaired', { name: data.peerName }), 'success');
      setLanPairCode('');
      closeLanModal();
      await Promise.all([refreshOverview(), loadData()]);
    } catch (e: any) {
      showToast(e.message || t('settings.lanPairFail'), 'error');
    } finally { setLanBusy(null); }
  }

  async function handleDisconnectPeer() {
    const newPlatforms = { ...platforms, lan: { ...(platforms.lan || {}), enabled: false } };
    setPlatforms(newPlatforms);
    await saveSync(newPlatforms);
    showToast(t('settings.sync2.disconnected'));
    await Promise.all([refreshOverview(), loadData()]);
  }

  // --- Platform cards (cloud backup collapsible) -----------------------------
  function updatePlatform(id: string, field: string, value: any) {
    const newPlatforms = { ...platforms, [id]: { ...(platforms[id] || {}), [field]: value } };
    setPlatforms(newPlatforms);
    saveSync(newPlatforms);
  }

  async function handleTestPlatform(platformId: string) {
    setTestingPlatform(platformId);
    await saveSync();
    try {
      const data = await testPlatform(platformId);
      showToast(data.message || (data.success ? t('settings.connSuccess') : t('settings.connFail')), data.success ? 'success' : 'error');
      await refreshOverview();
    } catch { showToast(t('settings.testConnFail'), 'error'); } finally { setTestingPlatform(null); }
  }

  function handleAddPlatform(platId: string) {
    if (!platId) return;
    updatePlatform(platId, 'enabled', true);
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

  // --- Derived ---------------------------------------------------------------
  const groups = [...new Set(vaultKeys.map(k => k.split('_')[0]).filter(Boolean))].sort();
  const lanCodes = pairing?.codes || [];
  const lanSelectedAddress = lanCodeAddress && lanCodes.some(c => c.address === lanCodeAddress)
    ? lanCodeAddress
    : (lanCodes[0]?.address || '');
  const lanSelectedCode = lanCodes.find(c => c.address === lanSelectedAddress)?.code || '';
  const pairingRemainingMs = pairing ? Math.max(0, new Date(pairing.expiresAt).getTime() - nowTs) : 0;
  const pairingExpired = !!pairing && pairingRemainingMs === 0;
  const remainingSecs = Math.ceil(pairingRemainingMs / 1000);
  const countdownLabel = `${Math.floor(remainingSecs / 60)}:${String(remainingSecs % 60).padStart(2, '0')}`;
  const platformEntries = Object.entries(PLATFORM_FIELDS).filter(([id]) => id !== 'lan');
  const activePlatformEntries = platformEntries.filter(([id]) => platforms[id]?.enabled);
  const inactivePlatformEntries = platformEntries.filter(([id]) => !platforms[id]?.enabled);
  const deviceCount = (overview?.peer ? 1 : 0) + (overview?.devices.length || 0);
  const cloudCount = overview?.cloudPlatforms.length || 0;
  const isSpoke = overview?.machine.role === 'spoke';

  return (
    <div className="settings-section devsync" id="sync">

      {/* 状态：摘要 + 自动同步 */}
      <div className="settings-block">
        <div className="settings-block-head">
          <span className="settings-block-title">{t('settings.sync2.statusTitle')}</span>
          <div className="settings-block-head-controls">
            <span className="devsync-autosync-label">{t('settings.autoSync')}</span>
            <label className="settings-toggle">
              <input type="checkbox" checked={autoSync} onChange={e => { setAutoSync(e.target.checked); saveSync(undefined, e.target.checked); }} />
              <span className="settings-toggle-slider" />
            </label>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-card-body">
            <div className="devsync-summary">
              <span>{t('settings.lastSync')}: {overview?.lastSyncAt ? new Date(overview.lastSyncAt).toLocaleString('zh-CN') : t('settings.neverSynced')}</span>
              <span className="devsync-summary-sep">·</span>
              <span>{t('settings.sync2.targets', { devices: deviceCount, clouds: cloudCount })}</span>
            </div>
            {overview && !overview.hasPassword && (
              <div className="settings-field settings-field--quiet">
                <label>{t('settings.syncPassword')}</label>
                <input type="password" className="settings-input" placeholder={t('settings.syncPasswordDesc')}
                  value={syncPassword} onChange={e => { setSyncPassword(e.target.value); }}
                  onBlur={savePassword} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 设备：本机 + 已配对设备 */}
      <div className="settings-block">
        <div className="settings-block-head">
          <span className="settings-block-title">{t('settings.sync2.devicesTitle')}</span>
          <div className="settings-block-head-controls">
            <button type="button" className="settings-test-btn" onClick={openLanModal}>
              + {t('settings.sync2.add')}
            </button>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-card-body settings-card-body--sync">
            <div className="devsync-devices">
              <div className="devsync-device devsync-device--self">
                <span className="devsync-dot devsync-dot--self" />
                <span className="devsync-device-name">
                  {overview?.machine.name || t('settings.sync2.thisDevice')}
                  {overview?.machine.id && <span className="settings-machine-id-suffix"> · {overview.machine.id}</span>}
                </span>
                {overview?.machine.role === 'hub' && <span className="devsync-role">{t('settings.sync2.roleHub')}</span>}
                {isSpoke && <span className="devsync-role">{t('settings.sync2.roleSpoke')}</span>}
              </div>

              {overview?.peer && (
                <div className="devsync-device">
                  <span className={`devsync-dot${overview.peer.online ? ' devsync-dot--on' : ''}`} />
                  <span className="devsync-device-name">
                    {overview.peer.name || overview.peer.url}
                    <span className="settings-machine-id-suffix"> · {overview.peer.url}</span>
                  </span>
                  <span className={`devsync-presence${overview.peer.online ? ' devsync-presence--on' : ''}`}>
                    {overview.peer.online ? t('settings.sync2.online') : t('settings.sync2.offline')}
                  </span>
                  <div className="devsync-device-actions">
                    <button className="settings-test-btn" onClick={() => handleTestPlatform('lan')} disabled={testingPlatform === 'lan'}>
                      {testingPlatform === 'lan' ? t('common.testing') : t('common.test')}
                    </button>
                    <button className="settings-test-btn" onClick={handleDisconnectPeer}>{t('settings.sync2.disconnect')}</button>
                  </div>
                </div>
              )}

              {overview?.devices.map(device => (
                <div key={device.id} className="devsync-device">
                  <span className={`devsync-dot${device.online ? ' devsync-dot--on' : ''}`} />
                  <span className="devsync-device-name">
                    {device.name || device.id}
                    <span className="settings-machine-id-suffix"> · {device.address} · {lastSeenLabel(device.lastSeen, t)}</span>
                  </span>
                  <span className={`devsync-presence${device.online ? ' devsync-presence--on' : ''}`}>
                    {device.online ? t('settings.sync2.online') : t('settings.sync2.offline')}
                  </span>
                </div>
              ))}

              {deviceCount === 0 && (
                <button type="button" className="devsync-add-slot" onClick={openLanModal}>
                  + {t('settings.sync2.addDevice')}
                </button>
              )}
            </div>

            {overview?.lan.enabled && (
              <div className="devsync-quiet-actions">
                <button type="button" className="devsync-quiet-btn" onClick={handleLanResetToken}>
                  {t('settings.lanResetToken')}
                </button>
                <span className="devsync-quiet-sep">·</span>
                <button type="button" className="devsync-quiet-btn" onClick={handleLanDisable} disabled={lanBusy === 'enable'}>
                  {lanBusy === 'enable' ? t('common.testing') : t('settings.lanCloseSync')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 云备份：平台配置（扁平结构，平台卡直接挂在分节下） */}
      <div className="settings-block">
        <div className="settings-block-head">
          <span className="settings-block-title">{t('settings.sync2.cloudBackup')}{cloudCount > 0 ? ` (${cloudCount})` : ''}</span>
          {inactivePlatformEntries.length > 0 && (
            <div className="settings-block-head-controls">
              <CustomSelect
                className="settings-select-wrap settings-add-platform-select"
                value=""
                onChange={handleAddPlatform}
                placeholder={t('settings.addPlatform')}
                options={inactivePlatformEntries.map(([id]: any) => ({ value: id, label: PLATFORM_IDS[id] || id }))}
              />
            </div>
          )}
        </div>
        <div className="settings-platforms">
          {activePlatformEntries.length === 0 ? (
            <div className="settings-platforms-empty">{t('settings.noActivePlatform')}</div>
          ) : activePlatformEntries.map(([platId, fields]) => {
            const plat = platforms[platId] || {};
            const testing = testingPlatform === platId;
            return (
              <div key={platId} className="settings-plat-card">
                <div className="settings-plat-header">
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
                {fields.length > 0 && (
                  <div className="settings-plat-body">
                    {fields.map(field => {
                      const isSecret = !PLAIN_SECRET_FIELDS.has(field) && (VAULT_REF_FIELDS.has(field) || (/ecret|oken|Key|Id$/i.test(field) && !/databaseId|bucketName|region/i.test(field)));
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
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Device dialog — choice first, then generate (primary) or paste
          (join). Everything pairing-related lives here, never in the section. */}
      {lanModalOpen && (
        <div className="auth-overlay" style={{ display: '' }} onClick={e => { if (e.target === e.currentTarget) closeLanModal(); }}>
          <div className="confirm-panel lan-modal" style={{ maxWidth: 560, textAlign: 'left' }}>
            <div className="progress-header">
              <span className="progress-title">{t('settings.sync2.addDevice')}</span>
              <button className="progress-close" onClick={closeLanModal}>&times;</button>
            </div>
            <div className="lan-modal-body">
              {lanModalStep === 'choice' && (
                <>
                  <button type="button" className="lan-choice" onClick={choosePrimary} disabled={lanBusy === 'enable'}>
                    <span className="lan-choice-title">{t('settings.lanChoiceOld')}</span>
                    <span className="lan-choice-desc">{t('settings.lanChoiceOldDesc')}</span>
                  </button>
                  <button type="button" className="lan-choice" onClick={() => setLanModalStep('join')}>
                    <span className="lan-choice-title">{t('settings.lanChoiceNew')}</span>
                    <span className="lan-choice-desc">{t('settings.lanChoiceNewDesc')}</span>
                  </button>
                </>
              )}

              {lanModalStep === 'primary' && (
                <>
                  <button type="button" className="lan-back" onClick={() => { setLanModalStep('choice'); setPairing(null); }}>
                    ← {t('settings.lanBack')}
                  </button>
                  {pairingDone ? (
                    <div className="lan-modal-countdown">✓ {t('settings.lanPairedSuccess')}</div>
                  ) : (
                    <>
                      {overview && overview.lan.enabled && !overview.lan.running && (
                        <div className="lan-modal-error">{overview.lan.error || t('settings.lanPairCodeEmpty')}</div>
                      )}
                      {pairing && !pairingExpired ? (
                        <>
                          <div className="lan-modal-label">{t('settings.lanPairCode')}</div>
                          <div className="lan-code-value devsync-code-value">
                            <span className="lan-code-text" title={lanSelectedCode}>{lanSelectedCode}</span>
                            <button className="settings-vault-new-btn settings-meta-copy" onClick={() => { navigator.clipboard.writeText(lanSelectedCode); showToast(t('common.copied')); }} title={t('vault.copy')}>
                              <svg width="10" height="10" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="5" y="5" width="10" height="10" rx="1.5" /><path d="M3 13V3a1.5 1.5 0 011.5-1.5H13" /></svg>
                            </button>
                            {lanCodes.length > 1 && (
                              <CustomSelect
                                className="settings-select-wrap lan-address-select"
                                value={lanSelectedAddress}
                                onChange={(v: string) => setLanCodeAddress(v)}
                                options={lanCodes.map(c => ({ value: c.address, label: c.address }))}
                              />
                            )}
                          </div>
                          <div className="lan-modal-countdown">{t('settings.lanCodeExpiresIn', { time: countdownLabel })}</div>
                        </>
                      ) : (
                        pairingExpired && <div className="lan-modal-countdown lan-modal-countdown--expired">{t('settings.lanCodeExpired')}</div>
                      )}
                      <div className="settings-sync-actions">
                        <button className="settings-test-btn" onClick={() => generatePairing()} disabled={lanBusy === 'pairing' || lanBusy === 'enable'}>
                          {lanBusy === 'pairing' || lanBusy === 'enable'
                            ? t('common.testing')
                            : (pairing && !pairingExpired ? t('settings.lanRegenCode') : t('settings.lanGenCode'))}
                        </button>
                      </div>
                      <div className="lan-hint">{t('settings.lanCodeHint')}</div>
                    </>
                  )}
                </>
              )}

              {lanModalStep === 'join' && (
                <>
                  <button type="button" className="lan-back" onClick={() => setLanModalStep('choice')}>
                    ← {t('settings.lanBack')}
                  </button>
                  <div className="lan-pair-row">
                    <input type="text" className="settings-input" placeholder={t('settings.lanPairPlaceholder')}
                      value={lanPairCode} onChange={e => setLanPairCode(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleLanPair(); }} />
                    <button className="settings-test-btn" onClick={handleLanPair} disabled={lanBusy === 'pair'}>
                      {lanBusy === 'pair' ? t('settings.lanPairing') : t('settings.lanConnect')}
                    </button>
                  </div>
                  <div className="lan-hint">{t('settings.lanPasswordHint')}</div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
                {Object.keys(doc.fields).length > 0 && (
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
                )}
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
