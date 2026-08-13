import { useEffect, useState, useRef, useMemo } from 'react';
import { listVault, deleteVault, getVaultValue, checkKeyImpact, exportVault, importVault, type VaultSecret } from '../../api/vault';
import { formatDate } from '../../lib/utils';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import VaultFormModal from '../shared/VaultFormModal';

type IconName = 'plus' | 'download' | 'upload' | 'copy' | 'edit' | 'trash' | 'search' | 'more';

const COLLAPSED_GROUP_LIMIT = 9;

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, character => entities[character]);
}

function Icon({ name }: { name: IconName }) {
  const common = { width: 15, height: 15, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<IconName, React.ReactNode> = {
    plus: <path d="M9 3v12M3 9h12" />,
    download: <><path d="M9 3v8" /><path d="M5.5 8.5 9 12l3.5-3.5" /><path d="M3 14.5h12" /></>,
    upload: <><path d="M9 15V7" /><path d="M5.5 9.5 9 6l3.5 3.5" /><path d="M3 3.5h12" /></>,
    copy: <><rect x="6" y="6" width="9" height="9" rx="1.5" /><path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12" /></>,
    edit: <><path d="M10.5 4.5 13.5 7.5" /><path d="M4 14l3.2-.8 7-7a2.1 2.1 0 0 0-3-3l-7 7Z" /></>,
    trash: <><path d="M3 5h12" /><path d="M7 5V3.5h4V5" /><path d="M5 5l.8 10h6.4L13 5" /></>,
    search: <><circle cx="8" cy="8" r="4.5" /><path d="m11.5 11.5 3 3" /></>,
    more: <><circle cx="4" cy="9" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" /><circle cx="14" cy="9" r="1" fill="currentColor" stroke="none" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

export default function VaultPage() {
  const { showToast, confirm, setConnectionStatus } = useApp();
  const { t } = useI18n();
  const [secrets, setSecrets] = useState<VaultSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState('all');
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editSecret, setEditSecret] = useState<VaultSecret | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const moreActionsRef = useRef<HTMLDivElement>(null);
  const moreActionsButtonRef = useRef<HTMLButtonElement>(null);
  const moreActionsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadVault(); }, []);

  useEffect(() => {
    if (!showMoreActions) return;

    const frame = requestAnimationFrame(() => {
      moreActionsMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    });
    const handlePointerDown = (event: MouseEvent) => {
      if (!moreActionsRef.current?.contains(event.target as Node)) setShowMoreActions(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowMoreActions(false);
      moreActionsButtonRef.current?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showMoreActions]);

  function handleMoreMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(moreActionsMenuRef.current?.querySelectorAll<HTMLButtonElement>('button') || [])];
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + items.length) % items.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    items[nextIndex].focus();
  }

  async function loadVault() {
    setLoading(true);
    try {
      const data = await listVault();
      setSecrets(data.secrets || []);
      setConnectionStatus('connected');
    } catch { setConnectionStatus('error'); } finally { setLoading(false); }
  }

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const s of secrets) { if (s.group) set.add(s.group); }
    return [...set].sort();
  }, [secrets]);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const secret of secrets) {
      if (!secret.group) continue;
      counts.set(secret.group, (counts.get(secret.group) || 0) + 1);
    }
    return counts;
  }, [secrets]);

  const orderedGroupFilters = useMemo(() => (
    [...groups].sort((a, b) => {
      const countDifference = (groupCounts.get(b) || 0) - (groupCounts.get(a) || 0);
      return countDifference || a.localeCompare(b);
    })
  ), [groups, groupCounts]);

  const visibleGroupFilters = useMemo(() => {
    if (showAllGroups || orderedGroupFilters.length <= COLLAPSED_GROUP_LIMIT) {
      return orderedGroupFilters;
    }

    const visible = orderedGroupFilters.slice(0, COLLAPSED_GROUP_LIMIT);
    if (groupFilter !== 'all' && !visible.includes(groupFilter)) visible.push(groupFilter);
    return visible;
  }, [groupFilter, orderedGroupFilters, showAllGroups]);

  const hiddenGroupCount = Math.max(0, orderedGroupFilters.length - visibleGroupFilters.length);

  useEffect(() => {
    if (groupFilter !== 'all' && !groups.includes(groupFilter)) {
      setGroupFilter('all');
    }
  }, [groupFilter, groups]);

  const filtered = useMemo(() => {
    const needle = searchTerm.toLowerCase();
    return secrets.filter(s => {
      if (groupFilter !== 'all' && (s.group || '') !== groupFilter) return false;
      if (needle) {
        const haystack = [
          s.key,
          s.desc || '',
          s.group || '',
        ].join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [secrets, groupFilter, searchTerm]);

  function openAddForm() {
    setEditKey(null);
    setEditSecret(null);
    setShowForm(true);
  }

  function openEditForm(secret: VaultSecret) {
    setEditKey(secret.key);
    setEditSecret(secret);
    setShowForm(true);
  }

  function handleFormSaved(key: string) {
    if (key) showToast(t(editKey ? 'vault.keyUpdated' : 'vault.keyAdded'));
    else showToast(t('vault.saveFail'), 'error');
    setShowForm(false);
    setEditSecret(null);
    setEditKey(null);
    loadVault();
  }

  async function confirmEditImpact(secret: VaultSecret | null) {
    if (!secret) return true;
    let projects = (secret.projects || []).map(p => p.path);
    try {
      const impact = await checkKeyImpact(secret.key);
      if (impact.projects?.length) projects = impact.projects;
    } catch {}
    if (projects.length === 0) return true;
    const impactHtml = `<div style="margin-top:8px">${t('vault.editImpact', { n: projects.length })}<br/>${projects.map(p => `- ${escapeHtml(p)}`).join('<br/>')}</div>`;
    return confirm(impactHtml);
  }

  async function handleDelete(secret: VaultSecret) {
    const key = secret.key;
    let impactHtml = '';
    try {
      const imp = await checkKeyImpact(key);
      if (imp.projects && imp.projects.length > 0) {
        impactHtml = `<div style="margin-top:8px">${t('vault.keyImpact', { n: imp.projects.length })}<br/>${imp.projects.map((p: string) => `- ${escapeHtml(p)}`).join('<br/>')}</div>`;
      }
    } catch {}
    const ok = await confirm(t('vault.confirmDelete', { key: `<strong>${escapeHtml(key)}</strong>` }) + `.${impactHtml}`);
    if (!ok) return;
    try {
      await deleteVault(key);
      showToast(t('vault.deleted', { key }));
      loadVault();
    } catch { showToast(t('vault.deleteFail'), 'error'); }
  }

  async function handleCopy(key: string) {
    try {
      const data = await getVaultValue(key);
      await navigator.clipboard.writeText(data.value);
      showToast(t('vault.copySuccess'));
    } catch { showToast(t('vault.copyFail'), 'error'); }
  }

  async function handleExport() {
    try {
      const blob = await exportVault();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'okit-vault-export.json'; a.click();
      URL.revokeObjectURL(url);
      showToast(t('vault.exportDownloaded'));
    } catch { showToast(t('vault.exportFail'), 'error'); }
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.secrets || !Array.isArray(data.secrets)) { showToast(t('vault.importInvalid'), 'error'); return; }
      const result = await importVault(data);
      showToast(t('vault.importDone', { added: result.imported, skipped: result.skipped }));
      loadVault();
    } catch { showToast(t('vault.importFail'), 'error'); }
  }

  const groupedFiltered = useMemo(() => {
    const map = new Map<string, VaultSecret[]>();
    for (const s of filtered) {
      const g = s.group || '';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    const sorted = [...map.entries()].sort(([a], [b]) => {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [filtered]);

  function toggleGroup(group: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }

  if (loading) return <div className="loading"><div className="loading-dots"><span></span><span></span><span></span></div>{t('common.loading')}</div>;

  return (
    <div className="vault-page">
      <div className="vault-workspace">
        {/* Group filters */}
        <div className="vault-filter-bar">
          <div className="vault-filter-section">
            <span className="vault-filter-section-label">{t('common.group')}</span>
            <div className="vault-filter-section-chips">
              <button
                className={`vault-filter-chip${groupFilter === 'all' ? ' vault-filter-chip--active' : ''}`}
                onClick={() => setGroupFilter('all')}
              >
                {t('common.all')}
                <span className="vault-chip-count">{secrets.length}</span>
              </button>
              {visibleGroupFilters.map(g => (
                <button
                  key={g}
                  className={`vault-filter-chip${groupFilter === g ? ' vault-filter-chip--active' : ''}`}
                  onClick={() => setGroupFilter(g)}
                >
                  {g}
                  <span className="vault-chip-count">{groupCounts.get(g) || 0}</span>
                </button>
              ))}
              {orderedGroupFilters.length > COLLAPSED_GROUP_LIMIT && (
                <button
                  className="vault-filter-toggle"
                  aria-expanded={showAllGroups}
                  onClick={() => setShowAllGroups(value => !value)}
                >
                  {showAllGroups ? t('vault.collapseGroups') : t('vault.moreGroups', { n: hiddenGroupCount })}
                  <span aria-hidden="true">⌄</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="vault-command-bar">
          <div className="vault-search">
            <Icon name="search" />
            <input type="text" className="search-input" placeholder={t('vault.searchKey')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <div className="vault-toolbar-right">
            <button className="vault-toolbar-btn vault-toolbar-btn--primary" onClick={openAddForm} title={t('vault.addKey')}>
              <Icon name="plus" />
              <span>{t('vault.add')}</span>
            </button>
            <div className="vault-toolbar-more" ref={moreActionsRef}>
              <button
                ref={moreActionsButtonRef}
                className="vault-toolbar-btn vault-toolbar-btn--quiet"
                aria-haspopup="menu"
                aria-expanded={showMoreActions}
                aria-label={t('vault.moreActions')}
                title={t('vault.moreActions')}
                onClick={() => setShowMoreActions(value => !value)}
              >
                <Icon name="more" />
              </button>
              {showMoreActions && (
                <div
                  ref={moreActionsMenuRef}
                  className="vault-more-menu"
                  role="menu"
                  onKeyDown={handleMoreMenuKeyDown}
                >
                  <button role="menuitem" onClick={() => { setShowMoreActions(false); handleExport(); }}>
                    <Icon name="download" />
                    <span>{t('common.export')}</span>
                  </button>
                  <button role="menuitem" onClick={() => { setShowMoreActions(false); importRef.current?.click(); }}>
                    <Icon name="upload" />
                    <span>{t('common.import')}</span>
                  </button>
                </div>
              )}
            </div>
            <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) handleImport(e.target.files[0]); e.target.value = ''; }} />
          </div>
        </div>

        <div className="vault-list vault-secret-list">
            {filtered.length === 0 && (
              <div className="vault-empty-state">
                <strong>{t('vault.emptyTitle')}</strong>
                <span>{t('vault.emptyDesc')}</span>
              </div>
            )}
            {groupedFiltered.map(([group, items]) => {
              const isCollapsed = collapsedGroups.has(group);
              return (
                <div key={group} className="vault-group">
                  <div className="vault-group-header" onClick={() => toggleGroup(group)}>
                    <span className={`vault-group-toggle${isCollapsed ? ' collapsed' : ''}`}>⌄</span>
                    <span className="vault-group-name">{group || t('common.ungrouped')}</span>
                    <span className="vault-group-count">{items.length}</span>
                  </div>
                  {!isCollapsed && items.map((secret) => (
                    <article key={secret.key} className="vault-card vault-secret-row">
                      <div className="vault-secret-main">
                        <div className="vault-secret-title">
                          <span className="vault-key">{secret.key}</span>
                          {secret.desc && <span className="vault-secret-desc" title={secret.desc}>{secret.desc}</span>}
                        </div>
                      </div>
                      <div className="vault-secret-value">
                        <span className="vault-masked">{secret.masked || '***'}</span>
                      </div>
                      <time className="vault-date">{formatDate(secret.updatedAt)}</time>
                      <div className="vault-card-actions">
                        <button className="btn-icon btn-icon--copy" title={t('vault.copy')} onClick={() => handleCopy(secret.key)}><Icon name="copy" /></button>
                        <button className="btn-icon" title={t('common.edit')} onClick={() => openEditForm(secret)}><Icon name="edit" /></button>
                        <button className="btn-icon btn-icon--danger" title={t('common.delete')} onClick={() => handleDelete(secret)}><Icon name="trash" /></button>
                      </div>
                    </article>
                  ))}
                </div>
              );
            })}
        </div>
      </div>

      {/* Add/Edit form modal */}
      {showForm && (
        <VaultFormModal
          groups={groups}
          initialSecret={editSecret || undefined}
          onBeforeSave={() => confirmEditImpact(editSecret)}
          onClose={() => { setShowForm(false); setEditSecret(null); setEditKey(null); }}
          onSaved={handleFormSaved}
        />
      )}
    </div>
  );
}
