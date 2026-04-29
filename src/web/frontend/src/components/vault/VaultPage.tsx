import { useEffect, useState, useRef, useMemo } from 'react';
import { listVault, deleteVault, getVaultValue, syncToProject, browseDirs, checkKeyImpact, exportVault, importVault, type VaultSecret } from '../../api/vault';
import { getSettings } from '../../api/settings';
import { formatDate, formatBytes } from '../../lib/utils';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import CustomSelect from '../shared/CustomSelect';
import VaultFormModal from '../shared/VaultFormModal';
import PageSidebar from '../shared/PageSidebar';
import { PLATFORM_IDS, PLATFORM_FIELDS } from '../../lib/constants';

type ViewMode = 'keys' | 'projects';

export default function VaultPage() {
  const { showToast, confirm, setConnectionStatus } = useApp();
  const { t } = useI18n();
  const [secrets, setSecrets] = useState<VaultSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('keys');
  const [groupFilter, setGroupFilter] = useState('all');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [syncKey, setSyncKey] = useState('');
  const [syncPath, setSyncPath] = useState('');
  const [syncDirs, setSyncDirs] = useState<any>(null);
  const [syncSidebar, setSyncSidebar] = useState<{ label: string; path: string; icon: string }[]>([]);
  const [showCloud, setShowCloud] = useState(false);
  const [cloudKeys, setCloudKeys] = useState<string[]>([]);
  const [cloudPlatform, setCloudPlatform] = useState<string>('');
  const [cloudPlatforms, setCloudPlatforms] = useState<string[]>([]);
  const [clouding, setClouding] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadVault(); loadCloudPlatforms(); }, []);

  async function loadCloudPlatforms() {
    try {
      const s = await getSettings() as any;
      const plats = s.sync?.platforms || {};
      const enabled = Object.entries(plats).filter(([, p]: any) => p.enabled).map(([id]: any) => id);
      setCloudPlatforms(enabled);
      if (enabled.length > 0 && !cloudPlatform) setCloudPlatform(enabled[0]);
    } catch {}
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

  const filtered = useMemo(() => {
    return secrets.filter(s => {
      if (groupFilter !== 'all' && (s.group || '') !== groupFilter) return false;
      if (searchTerm && !s.key.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [secrets, groupFilter, searchTerm]);

  function openAddForm() {
    setEditKey(null);
    setShowForm(true);
  }

  function openEditForm(secret: VaultSecret) {
    setEditKey(secret.key);
    setShowForm(true);
  }

  function handleFormSaved(key: string) {
    if (key) showToast(t(editKey ? 'vault.keyUpdated' : 'vault.keyAdded'));
    else showToast(t('vault.saveFail'), 'error');
    setShowForm(false);
    loadVault();
  }

  async function handleDelete(key: string, alias: string) {
    let impactHtml = '';
    try {
      const imp = await checkKeyImpact(key);
      if (imp.projects && imp.projects.length > 0) {
        impactHtml = `<div style="margin-top:8px">${t('vault.keyImpact', { n: imp.projects.length })}<br/>${imp.projects.map((p: string) => `- ${p}`).join('<br/>')}</div>`;
      }
    } catch {}
    const ok = await confirm(t('vault.confirmDelete', { key: `<strong>${key}</strong>` }) + `.${impactHtml}`);
    if (!ok) return;
    try {
      await deleteVault(key, alias);
      showToast(t('vault.deleted', { key }));
      loadVault();
    } catch { showToast(t('vault.deleteFail'), 'error'); }
  }

  async function handleCopy(key: string, alias: string) {
    try {
      const data = await getVaultValue(key, alias);
      await navigator.clipboard.writeText(data.value);
      showToast(t('vault.copySuccess'));
    } catch { showToast(t('vault.copyFail'), 'error'); }
  }

  // Sync project modal
  async function openSyncModal(key: string, alias: string) {
    setSyncKey(key);
    setSyncPath('');
    setShowSync(true);
    try {
      const data = await browseDirs('');
      const home = data.currentPath;
      setSyncSidebar([
        { label: t('vault.dirs.home'), path: home, icon: '🏠' },
        { label: t('vault.dirs.desktop'), path: home + '/Desktop', icon: '🖥' },
        { label: t('vault.dirs.documents'), path: home + '/Documents', icon: '📄' },
        { label: t('vault.dirs.downloads'), path: home + '/Downloads', icon: '📥' },
        { label: t('vault.dirs.root'), path: '/', icon: '💾' },
      ]);
      setSyncDirs(data);
      setSyncPath(data.currentPath);
    } catch { showToast(t('vault.dirFail'), 'error'); }
  }

  async function browseDir(dir: string) {
    try {
      const data = await browseDirs(dir);
      setSyncDirs(data);
      setSyncPath(data.currentPath);
    } catch { showToast(t('vault.dirFail'), 'error'); }
  }

  async function confirmSync() {
    if (!syncPath) { showToast(t('vault.selectDir'), 'error'); return; }
    try {
      const data = await syncToProject([{ key: syncKey, alias: 'default' }], syncPath);
      setShowSync(false);
      showToast(t('vault.written', { n: data.synced }));
      loadVault();
    } catch { showToast(t('vault.syncFail'), 'error'); }
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

  // Project view
  const projectMap = useMemo(() => {
    const map = new Map<string, { name: string; path: string; keys: VaultSecret[] }>();
    const unbound: VaultSecret[] = [];
    for (const s of secrets) {
      if (s.projects && s.projects.length > 0) {
        for (const p of s.projects) {
          if (!map.has(p.path)) map.set(p.path, { name: p.name, path: p.path, keys: [] });
          map.get(p.path)!.keys.push(s);
        }
      } else { unbound.push(s); }
    }
    return { map, unbound };
  }, [secrets]);

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

  function toggleCloudKey(key: string) {
    setCloudKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function selectAllCloud() {
    setCloudKeys(filtered.map(s => s.key));
  }

  function clearCloudKeys() {
    setCloudKeys([]);
  }

  async function handleCloudPush() {
    if (!cloudPlatform || cloudKeys.length === 0) { showToast(t('vault.selectPlatformKey'), 'error'); return; }
    setClouding(true);
    try {
      const res = await fetch('/api/settings/sync-to-cloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: cloudPlatform, keys: cloudKeys }),
      });
      const result = await res.json();
      if (result.success) {
        const results = result.results || [];
        const ok = results.filter((r: any) => r.success).length;
        const failed = results.filter((r: any) => !r.success);
        if (failed.length === 0) {
          showToast(t('vault.pushSuccess', { n: ok, platform: PLATFORM_IDS[cloudPlatform] || cloudPlatform }));
        } else {
          const names = failed.map((r: any) => `${r.key} (${r.error})`).join('、');
          showToast(t('vault.pushResult', { success: ok, failed: failed.length, names }), 'error');
        }
        setShowCloud(false);
        setCloudKeys([]);
      } else {
        showToast(result.error || t('vault.pushFail'), 'error');
      }
    } catch (e: any) { showToast(e.message || t('vault.pushFail'), 'error'); } finally { setClouding(false); }
  }

  if (loading) return <div className="loading"><div className="loading-dots"><span></span><span></span><span></span></div>{t('common.loading')}</div>;

  return (
    <div className="page-with-sidebar">
      {/* Sidebar */}
      <PageSidebar sections={[
        {
          title: t('common.group'),
          items: [
            { key: '__all__', label: t('common.all'), count: secrets.length, active: viewMode === 'keys' && groupFilter === 'all', onClick: () => { setViewMode('keys'); setGroupFilter('all'); } },
            ...groups.map(g => ({
              key: `g-${g}`,
              label: g,
              count: secrets.filter(s => s.group === g).length,
              active: viewMode === 'keys' && groupFilter === g,
              onClick: () => { setViewMode('keys'); setGroupFilter(g); },
            })),
            { key: '__none__', label: t('common.ungrouped'), count: secrets.filter(s => !s.group).length, active: viewMode === 'keys' && groupFilter === '', onClick: () => { setViewMode('keys'); setGroupFilter(''); } },
          ],
        },
        ...(projectMap.map.size > 0 ? [{
          title: t('vault.syncProjects'),
          items: Array.from(projectMap.map.entries()).map(([path, proj]) => ({
            key: `proj-${path}`,
            label: proj.name,
            count: proj.keys.length,
            active: viewMode === 'projects' && selectedProject === path,
            onClick: () => { setViewMode('projects'); setSelectedProject(path); },
          })),
        }] : []),
      ]} />

      {/* Main content */}
      <div className="page-sidebar-main">
        {/* Toolbar */}
        <div className="vault-toolbar">
          <div className="vault-toolbar-left">
            <div className="search-paper">
              <input type="text" className="search-input" placeholder={t('vault.searchKey')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
          </div>
          <div className="vault-toolbar-right">
            <button className="vault-toolbar-btn" onClick={openAddForm} title={t('vault.addKey')}>
              <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 3v12M3 9h12" /></svg>
              <span>{t('vault.add')}</span>
            </button>
            <button className="vault-toolbar-btn" onClick={handleExport} title={t('common.export')}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 10v2h10v-2M7 2v8M4 7l3 3 3-3" /></svg>
            </button>
            <button className="vault-toolbar-btn" onClick={() => importRef.current?.click()} title={t('common.import')}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 4v-2h10v2M7 12V5M4 8l3-3 3 3" /></svg>
            </button>
            <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) handleImport(e.target.files[0]); e.target.value = ''; }} />
            <button className="vault-toolbar-btn" onClick={() => loadVault()} title={t('common.refresh')}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 7A5 5 0 1 1 7 2c1.4 0 2.6.6 3.5 1.5" /><path d="M12 2v3h-3" /></svg>
            </button>
            {cloudPlatforms.length > 0 && (
              <button className={`vault-toolbar-btn${showCloud ? ' vault-toolbar-btn--active' : ''}`} onClick={() => { setShowCloud(!showCloud); setCloudKeys([]); }} title={t('vault.pushCloud')}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 10.5A3.5 3.5 0 0 1 4.5 4a5 5 0 0 1 9.5 1.5A2.5 2.5 0 0 1 13 11H3.5" /></svg>
                <span>{t('vault.push')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Cloud push actions bar */}
        {showCloud && viewMode === 'keys' && (
          <div className="cloud-push-bar">
            <div className="cloud-push-bar-left">
              <span className="cloud-push-count">{t('vault.selected', { n: cloudKeys.length })}</span>
              <button className="cloud-push-link" onClick={selectAllCloud}>{t('common.selectAll')}</button>
              <button className="cloud-push-link" onClick={clearCloudKeys}>{t('common.deselect')}</button>
            </div>
            <div className="cloud-push-bar-right">
              <CustomSelect
                className="cloud-push-select"
                value={cloudPlatform}
                onChange={setCloudPlatform}
                placeholder={t('vault.selectPlatform')}
                options={cloudPlatforms.map(id => ({ value: id, label: PLATFORM_IDS[id] || id }))}
              />
              <button className="btn-save" onClick={handleCloudPush} disabled={clouding || cloudKeys.length === 0}>
                {clouding ? t('vault.pushing') : t('vault.confirmPush')}
              </button>
            </div>
          </div>
        )}

        {/* Keys view */}
        {viewMode === 'keys' && (
          <div className="vault-list">
            {filtered.length === 0 && <div className="loading" style={{ padding: 40 }}>{t('vault.noKeys')}</div>}
            {groupedFiltered.map(([group, items]) => {
              const isCollapsed = collapsedGroups.has(group);
              return (
                <div key={group} className="vault-group">
                  <div className="vault-group-header" onClick={() => toggleGroup(group)}>
                    <span className={`vault-group-toggle${isCollapsed ? ' collapsed' : ''}`}>▼</span>
                    <span className="vault-group-name">{group || t('common.ungrouped')}</span>
                    <span className="vault-group-count">{items.length}</span>
                  </div>
                  {!isCollapsed && items.map((secret) => (
                    <div key={secret.key} className={`vault-card${showCloud && cloudKeys.includes(secret.key) ? ' vault-card--selected' : ''}`}>
                      <div className="vault-card-body">
                        <div className="vault-card-row">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {showCloud && (
                              <input type="checkbox" className="cloud-checkbox" checked={cloudKeys.includes(secret.key)} onChange={() => toggleCloudKey(secret.key)} />
                            )}
                            <span className="vault-key">{secret.key}</span>
                          </div>
                          <div className="vault-card-actions">
                            <button className="btn-icon btn-icon--copy" title={t('vault.copy')} onClick={() => handleCopy(secret.key, secret.aliases[0]?.alias || 'default')}>📋</button>
                            <button className="btn-icon" title={t('vault.syncToProject')} onClick={() => openSyncModal(secret.key, secret.aliases[0]?.alias || 'default')}>☁️</button>
                            <button className="btn-icon" title={t('common.edit')} onClick={() => openEditForm(secret)}>✏️</button>
                            <button className="btn-icon btn-icon--danger" title={t('common.delete')} onClick={() => handleDelete(secret.key, secret.aliases[0]?.alias || 'default')}>🗑</button>
                          </div>
                        </div>
                        <div className="vault-aliases">
                          {secret.aliases.map(a => (
                            <div key={a.alias} className="vault-alias-row">
                              <span className="vault-masked">{a.masked}</span>
                              <span className="vault-date">{formatDate(a.updatedAt)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Projects view */}
        {viewMode === 'projects' && (
          <div className="vault-list">
            {Array.from(projectMap.map.entries())
              .filter(([path]) => !selectedProject || path === selectedProject)
              .map(([path, proj]) => (
                <div key={path} className="project-card">
                  <div className="project-card-body">
                    <div className="project-card-header">
                      <span className="project-name">{proj.name}</span>
                      <span className="project-path">{path}</span>
                    </div>
                    {proj.keys.map(s => (
                      <div key={s.key} className="project-key-item">
                        <span className="project-key-name">{s.key}</span>
                        <span className="project-key-masked">{s.aliases[0]?.masked}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Add/Edit form modal */}
      {showForm && (
        <VaultFormModal
          groups={groups}
          initialKey={editKey || undefined}
          onClose={() => setShowForm(false)}
          onSaved={handleFormSaved}
        />
      )}

      {/* Sync project modal */}
      {showSync && syncDirs && (
        <div className="auth-overlay" style={{ display: '' }}>
          <div className="sync-panel">
            <div className="progress-header">
              <span className="progress-title">{t('vault.syncProject')}</span>
              <button className="progress-close" onClick={() => setShowSync(false)}>&times;</button>
            </div>
            <div className="sync-body">
              <div className="sync-main">
                <div className="sync-sidebar">
                  <div className="sync-sidebar-label">{t('vault.quickAccess')}</div>
                  {syncSidebar.map((s, i) => (
                    <div key={i} className={`sync-sidebar-item${s.path === syncPath ? ' sync-sidebar-item--active' : ''}`}
                      onClick={() => browseDir(s.path)}>{s.icon} {s.label}</div>
                  ))}
                </div>
                <div className="sync-content">
                  <div className="sync-path-bar">{syncDirs.currentPath}</div>
                  <div className="sync-dir-list">
                    {syncDirs.parentPath && syncDirs.parentPath !== syncDirs.currentPath && (
                      <div className="sync-dir-item sync-dir-item--parent" onClick={() => browseDir(syncDirs.parentPath)}>📁 ..</div>
                    )}
                    {syncDirs.dirs.map((d: any) => (
                      <div key={d.path} className="sync-dir-item" onClick={() => browseDir(d.path)}>📁 {d.name}</div>
                    ))}
                    {syncDirs.dirs.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-muted)' }}>{t('vault.noSubDirs')}</div>}
                  </div>
                </div>
              </div>
            </div>
            <div className="sync-footer">
              <span className="sync-selected-info">{syncPath}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-cancel" onClick={() => setShowSync(false)}>{t('common.cancel')}</button>
                <button className="btn-save" onClick={confirmSync}>{t('vault.confirmSync')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
