import { useEffect, useState, useRef, useMemo } from 'react';
import { listVault, deleteVault, getVaultValue, syncToProject, browseDirs, checkKeyImpact, exportVault, importVault, type VaultSecret } from '../../api/vault';
import { getSettings } from '../../api/settings';
import { formatDate } from '../../lib/utils';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import CustomSelect from '../shared/CustomSelect';
import VaultFormModal from '../shared/VaultFormModal';
import PageSidebar from '../shared/PageSidebar';
import { PLATFORM_IDS, PLATFORM_FIELDS } from '../../lib/constants';

type ViewMode = 'keys' | 'projects';
type IconName = 'plus' | 'download' | 'upload' | 'refresh' | 'cloud' | 'copy' | 'folder' | 'edit' | 'trash' | 'search';

function Icon({ name }: { name: IconName }) {
  const common = { width: 15, height: 15, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<IconName, React.ReactNode> = {
    plus: <path d="M9 3v12M3 9h12" />,
    download: <><path d="M9 3v8" /><path d="M5.5 8.5 9 12l3.5-3.5" /><path d="M3 14.5h12" /></>,
    upload: <><path d="M9 15V7" /><path d="M5.5 9.5 9 6l3.5 3.5" /><path d="M3 3.5h12" /></>,
    refresh: <><path d="M14.5 9a5.5 5.5 0 1 1-1.6-3.9" /><path d="M14.5 3.5v4h-4" /></>,
    cloud: <path d="M5.3 14H13a3 3 0 0 0 .5-6A4.8 4.8 0 0 0 4.1 7 3.5 3.5 0 0 0 5.3 14Z" />,
    copy: <><rect x="6" y="6" width="9" height="9" rx="1.5" /><path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12" /></>,
    folder: <path d="M2.5 6.5h5l1.5 2h6.5v5A1.5 1.5 0 0 1 14 15H4a1.5 1.5 0 0 1-1.5-1.5Z" />,
    edit: <><path d="M10.5 4.5 13.5 7.5" /><path d="M4 14l3.2-.8 7-7a2.1 2.1 0 0 0-3-3l-7 7Z" /></>,
    trash: <><path d="M3 5h12" /><path d="M7 5V3.5h4V5" /><path d="M5 5l.8 10h6.4L13 5" /></>,
    search: <><circle cx="8" cy="8" r="4.5" /><path d="m11.5 11.5 3 3" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

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
    const needle = searchTerm.toLowerCase();
    return secrets.filter(s => {
      if (groupFilter !== 'all' && (s.group || '') !== groupFilter) return false;
      if (needle) {
        const haystack = [
          s.key,
          s.group || '',
          ...s.aliases.map(a => a.alias),
          ...(s.projects || []).flatMap(p => [p.name, p.path]),
        ].join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [secrets, groupFilter, searchTerm]);

  const vaultStats = useMemo(() => {
    const projectPaths = new Set<string>();
    let totalAliases = 0;
    for (const secret of secrets) {
      totalAliases += secret.aliases.length;
      for (const project of secret.projects || []) projectPaths.add(project.path);
    }
    return {
      totalAliases,
      projects: projectPaths.size,
    };
  }, [secrets]);

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
        ...(viewMode === 'keys' ? [{
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
        }] : []),
        ...(viewMode === 'projects' && projectMap.map.size > 0 ? [{
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
      <div className="page-sidebar-main vault-workspace">
        <header className="vault-hero">
          <div className="vault-hero-copy">
            <h1>{t('vault.title')}</h1>
            <p>{t('vault.lede')}</p>
          </div>
          <div className="vault-hero-stats" aria-label="Vault summary">
            <div>
              <span>{t('vault.totalKeys')}</span>
              <strong>{secrets.length}</strong>
            </div>
            <div>
              <span>{t('vault.aliases')}</span>
              <strong>{vaultStats.totalAliases}</strong>
            </div>
            <div>
              <span>{t('vault.projectBindings')}</span>
              <strong>{vaultStats.projects}</strong>
            </div>
            <div>
              <span>{t('vault.cloudTargets')}</span>
              <strong>{cloudPlatforms.length}</strong>
            </div>
          </div>
        </header>

        {/* Toolbar */}
        <div className="vault-command-bar">
          <div className="vault-search">
            <Icon name="search" />
            <input type="text" className="search-input" placeholder={t('vault.searchKey')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <div className="vault-view-switch" role="tablist" aria-label="Vault view">
            <button className={viewMode === 'keys' ? 'active' : ''} onClick={() => setViewMode('keys')}>{t('vault.keysView')}</button>
            <button className={viewMode === 'projects' ? 'active' : ''} onClick={() => setViewMode('projects')}>{t('vault.projectsView')}</button>
          </div>
          <div className="vault-toolbar-right">
            <button className="vault-toolbar-btn" onClick={openAddForm} title={t('vault.addKey')}>
              <Icon name="plus" />
              <span>{t('vault.add')}</span>
            </button>
            <button className="vault-toolbar-btn" onClick={handleExport} title={t('common.export')}>
              <Icon name="download" />
            </button>
            <button className="vault-toolbar-btn" onClick={() => importRef.current?.click()} title={t('common.import')}>
              <Icon name="upload" />
            </button>
            <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) handleImport(e.target.files[0]); e.target.value = ''; }} />
            <button className="vault-toolbar-btn" onClick={() => loadVault()} title={t('common.refresh')}>
              <Icon name="refresh" />
            </button>
            {cloudPlatforms.length > 0 && (
              <button className={`vault-toolbar-btn${showCloud ? ' vault-toolbar-btn--active' : ''}`} onClick={() => { setShowCloud(!showCloud); setCloudKeys([]); }} title={t('vault.pushCloud')}>
                <Icon name="cloud" />
                <span>{t('vault.push')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Cloud push actions bar */}
        {showCloud && viewMode === 'keys' && (
          <div className="cloud-push-bar">
            <div className="cloud-push-bar-left">
              <div>
                <strong>{t('vault.cloudPushTitle')}</strong>
                <span>{t('vault.cloudPushDesc')}</span>
              </div>
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
                    <article key={secret.key} className={`vault-card vault-secret-row${showCloud && cloudKeys.includes(secret.key) ? ' vault-card--selected' : ''}`}>
                      <div className="vault-secret-main">
                        {showCloud && (
                          <input type="checkbox" className="cloud-checkbox" checked={cloudKeys.includes(secret.key)} onChange={() => toggleCloudKey(secret.key)} aria-label={secret.key} />
                        )}
                        <div className="vault-secret-title">
                          <span className="vault-key">{secret.key}</span>
                          <div className="vault-secret-tags">
                            {secret.aliases.length > 1 && (
                              <span>{t('vault.aliasesCount', { n: secret.aliases.length })}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="vault-aliases">
                        {secret.aliases.map(a => (
                          <div key={a.alias} className="vault-alias-row">
                            <span className="vault-alias-name">{a.alias}</span>
                            <span className="vault-masked">{a.masked}</span>
                          </div>
                        ))}
                      </div>
                      <div className="vault-projects">
                        {(secret.projects || []).length > 0 ? secret.projects!.slice(0, 3).map(project => (
                          <span className="vault-project-tag" title={project.path} key={project.path}>{project.name}</span>
                        )) : <span className="vault-project-empty">{t('vault.localOnly')}</span>}
                        {(secret.projects || []).length > 3 && <span className="vault-project-tag">+{secret.projects!.length - 3}</span>}
                      </div>
                      <time className="vault-date">{formatDate(secret.aliases[0]?.updatedAt)}</time>
                      <div className="vault-card-actions">
                        <button className="btn-icon btn-icon--copy" title={t('vault.copy')} onClick={() => handleCopy(secret.key, secret.aliases[0]?.alias || 'default')}><Icon name="copy" /></button>
                        <button className="btn-icon btn-icon--sync" title={t('vault.syncToProject')} onClick={() => openSyncModal(secret.key, secret.aliases[0]?.alias || 'default')}><Icon name="folder" /></button>
                        <button className="btn-icon" title={t('common.edit')} onClick={() => openEditForm(secret)}><Icon name="edit" /></button>
                        <button className="btn-icon btn-icon--danger" title={t('common.delete')} onClick={() => handleDelete(secret.key, secret.aliases[0]?.alias || 'default')}><Icon name="trash" /></button>
                      </div>
                    </article>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Projects view */}
        {viewMode === 'projects' && (
          <div className="vault-list vault-project-list">
            {projectMap.map.size === 0 && (
              <div className="vault-empty-state">
                <strong>{t('vault.noProject')}</strong>
                <span>{t('vault.emptyDesc')}</span>
              </div>
            )}
            {Array.from(projectMap.map.entries())
              .filter(([path]) => !selectedProject || path === selectedProject)
              .map(([path, proj]) => (
                <article key={path} className="project-card">
                  <div className="project-card-body">
                    <div className="project-card-header">
                      <div>
                        <span className="project-name">{proj.name}</span>
                        <span className="project-path">{path}</span>
                      </div>
                      <span className="project-key-count">{proj.keys.length}</span>
                    </div>
                    <div className="project-key-list">
                      {proj.keys.map(s => (
                        <div key={s.key} className="project-key-item">
                          <span className="project-key-name">{s.key}</span>
                          <span className="project-key-masked">{s.aliases[0]?.masked}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
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
