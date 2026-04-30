import { useState, useEffect, useMemo } from 'react';
import { api } from '../../api/client';
import { setVault } from '../../api/vault';
import { useI18n } from '../../i18n';
import CustomSelect from './CustomSelect';

interface TestEndpoint {
  baseUrl: string;
  type: string;
}

interface VaultPickerModalProps {
  selected?: string;
  onSelect: (key: string) => void;
  onClose: () => void;
  testEndpoint?: TestEndpoint;
}

export default function VaultPickerModal({ selected, onSelect, onClose, testEndpoint }: VaultPickerModalProps) {
  const { t } = useI18n();
  const [secrets, setSecrets] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newAlias, setNewAlias] = useState('default');
  const [newGroup, setNewGroup] = useState('');
  const [newGroupCustom, setNewGroupCustom] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  function reload() {
    api('/api/vault').then((data: any) => {
      setSecrets(data.secrets || []);
    }).catch(() => {});
  }

  useEffect(() => { reload(); }, []);

  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of secrets) {
      const g = s.group || t('common.ungrouped');
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return Array.from(map.entries());
  }, [secrets, t]);

  const groupNames = useMemo(() => groups.map(([g]) => g).filter(g => g !== t('common.ungrouped')), [groups, t]);

  const filtered = useMemo(() => {
    const source = activeGroup ? (groups.find(([g]) => g === activeGroup)?.[1] || []) : secrets;
    if (!search.trim()) return source;
    const q = search.toLowerCase();
    return source.filter(s =>
      s.key.toLowerCase().includes(q) ||
      (s.aliases?.[0]?.alias || '').toLowerCase().includes(q) ||
      (s.group || '').toLowerCase().includes(q)
    );
  }, [secrets, groups, activeGroup, search]);

  async function handleCreate() {
    if (!newKey.trim() || !newValue.trim()) return;
    setCreating(true);
    try {
      const group = newGroup === '__custom__' ? newGroupCustom.trim() : newGroup.trim();
      await setVault({ key: newKey.trim(), alias: newAlias.trim() || 'default', value: newValue.trim(), group: group || undefined });
      await new Promise(r => setTimeout(r, 100));
      reload();
      onSelect(newKey.trim());
      resetCreate();
    } catch {}
    setCreating(false);
  }

  async function handleTest() {
    if (!newValue.trim() || !testEndpoint) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api('/api/vault/test-key', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: testEndpoint.baseUrl, type: testEndpoint.type, keyValue: newValue.trim() }),
      }) as any;
      setTestResult({ success: res.success, message: res.message });
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || String(err) || 'Test failed' });
    }
    setTesting(false);
  }

  function resetCreate() {
    setShowCreate(false);
    setNewKey('');
    setNewAlias('default');
    setNewGroup('');
    setNewGroupCustom('');
    setNewValue('');
    setShowValue(false);
    setTestResult(null);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="vault-picker" onClick={e => e.stopPropagation()}>
        <div className="vault-picker-header">
          <h2>{t('vaultPicker.title')}</h2>
          <button className="vault-picker-close" onClick={onClose}>×</button>
        </div>
        <div className="vault-picker-body">
          <aside className="vault-picker-sidebar">
            <div
              className={`vault-picker-group${!activeGroup ? ' active' : ''}`}
              onClick={() => setActiveGroup(null)}
            >
              <span>{t('common.all')}</span>
              <span className="vault-picker-group-count">{secrets.length}</span>
            </div>
            {groups.map(([g, items]) => (
              <div
                key={g}
                className={`vault-picker-group${activeGroup === g ? ' active' : ''}`}
                onClick={() => setActiveGroup(g)}
              >
                <span>{g}</span>
                <span className="vault-picker-group-count">{items.length}</span>
              </div>
            ))}
          </aside>
          <div className="vault-picker-main">
            <div className="vault-picker-search">
              <div className="vault-picker-search-field">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input
                  className="vault-picker-search-input"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('vaultPicker.search')}
                  autoFocus
                />
              </div>
              {!showCreate && (
                <button className="vault-picker-create-btn vault-picker-create-btn--toolbar" onClick={() => setShowCreate(true)}>
                  {t('vaultPicker.newKey')}
                </button>
              )}
            </div>
            <div className="vault-picker-list">
              {filtered.length === 0 && !showCreate && (
                <div className="vault-picker-empty">{t('vaultPicker.noMatch')}</div>
              )}
              {filtered.map(s => (
                <div
                  key={s.key}
                  className={`vault-picker-item${selected === s.key ? ' active' : ''}`}
                  onClick={() => onSelect(s.key)}
                >
                  <div className="vault-picker-item-top">
                    <span className="vault-picker-item-key">{s.key}</span>
                    {s.group && <span className="vault-picker-item-group">{s.group}</span>}
                  </div>
                  {s.aliases?.[0]?.alias && (
                    <span className="vault-picker-item-alias">{s.aliases[0].alias}</span>
                  )}
                </div>
              ))}
            </div>
            {showCreate && (
              <div className="vault-picker-create-form">
                <label className="vault-picker-create-field vault-picker-create-field--span">
                  <span className="vault-picker-create-label">{t('vaultPicker.keyLabel')}</span>
                  <input
                    className="vault-input vault-picker-create-input"
                    placeholder={t('vaultPicker.keyPlaceholder')}
                    value={newKey}
                    onChange={e => setNewKey(e.target.value)}
                    autoFocus
                  />
                </label>
                <div className="vault-picker-create-row">
                  <label className="vault-picker-create-field">
                    <span className="vault-picker-create-label">{t('common.alias')}</span>
                    <input
                      className="vault-input vault-picker-create-input"
                      placeholder="default"
                      value={newAlias}
                      onChange={e => setNewAlias(e.target.value)}
                    />
                  </label>
                  <label className="vault-picker-create-field">
                    <span className="vault-picker-create-label">{t('common.selectGroup')}</span>
                    <CustomSelect
                      className="vault-picker-create-select"
                      value={newGroup}
                      onChange={v => setNewGroup(v)}
                      placeholder={t('common.selectGroup')}
                      options={[
                        { value: '__custom__', label: t('common.manualInput') },
                        ...groupNames.map(g => ({ value: g, label: g })),
                      ]}
                    />
                  </label>
                </div>
                {newGroup === '__custom__' && (
                  <label className="vault-picker-create-field vault-picker-create-field--span">
                    <span className="vault-picker-create-label">{t('common.enterGroup')}</span>
                    <input
                      className="vault-input vault-picker-create-input"
                      placeholder={t('common.enterGroup')}
                      value={newGroupCustom}
                      onChange={e => setNewGroupCustom(e.target.value)}
                    />
                  </label>
                )}
                <label className="vault-picker-create-field vault-picker-create-field--span">
                  <span className="vault-picker-create-label">{t('vaultPicker.valueLabel')}</span>
                  <div className="vault-picker-create-value">
                    <input
                      className="vault-input vault-picker-create-input"
                      type={showValue ? 'text' : 'password'}
                      placeholder={t('vaultPicker.valuePlaceholder')}
                      value={newValue}
                      onChange={e => { setNewValue(e.target.value); setTestResult(null); }}
                    />
                    <button type="button" className="vault-picker-create-vis" onClick={() => setShowValue(!showValue)}>
                      {showValue ? t('common.hide') : t('common.show')}
                    </button>
                  </div>
                </label>
                {testEndpoint && newValue.trim() && (
                  <div className="vault-picker-test-row">
                    <button
                      type="button"
                      className="vault-picker-test-btn"
                      disabled={testing}
                      onClick={handleTest}
                    >
                      {testing ? t('common.testing') : t('common.test')}
                    </button>
                    {testResult && (
                      <span className={`vault-picker-test-result${testResult.success ? ' success' : ' fail'}`}>
                        {testResult.message}
                      </span>
                    )}
                  </div>
                )}
                <div className="vault-picker-create-actions">
                  <button className="btn-cancel" onClick={resetCreate}>{t('common.cancel')}</button>
                  <button className="btn-save" onClick={handleCreate} disabled={creating || !newKey.trim() || !newValue.trim()}>
                    {creating ? '...' : t('vaultPicker.createSelect')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
