import { useEffect, useState, useRef, useMemo } from 'react';
import { listVault, setVault, deleteVault, getVaultValue, syncToProject, browseDirs, checkKeyImpact, exportVault, importVault, type VaultSecret } from '../../api/vault';
import { formatDate, formatBytes } from '../../lib/utils';
import { useApp } from '../Layout/AppContext';

type ViewMode = 'keys' | 'projects';

export default function VaultPage() {
  const { showToast, confirm, setConnectionStatus } = useApp();
  const [secrets, setSecrets] = useState<VaultSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('keys');
  const [groupFilter, setGroupFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [formKey, setFormKey] = useState('');
  const [formAlias, setFormAlias] = useState('default');
  const [formValue, setFormValue] = useState('');
  const [formGroup, setFormGroup] = useState('');
  const [formGroupCustom, setFormGroupCustom] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [syncKey, setSyncKey] = useState('');
  const [syncPath, setSyncPath] = useState('');
  const [syncDirs, setSyncDirs] = useState<any>(null);
  const [syncSidebar, setSyncSidebar] = useState<{ label: string; path: string; icon: string }[]>([]);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadVault(); }, []);

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
    setFormKey('');
    setFormAlias('default');
    setFormValue('');
    setFormGroup('');
    setFormGroupCustom('');
    setShowValue(false);
    setShowForm(true);
  }

  function openEditForm(secret: VaultSecret) {
    setEditKey(secret.key);
    setFormKey(secret.key);
    setFormAlias(secret.aliases[0]?.alias || 'default');
    setFormValue('');
    setFormGroup(secret.group || '');
    setFormGroupCustom('');
    setShowValue(false);
    setShowForm(true);
  }

  async function handleSave() {
    if (!formKey || !formValue) { showToast('Key 和 Value 不能为空', 'error'); return; }
    const group = formGroup === '__custom__' ? formGroupCustom : formGroup;
    try {
      await setVault({ key: formKey, alias: formAlias || 'default', value: formValue, group: group || undefined });
      showToast(editKey ? '密钥已更新' : '密钥已添加');
      setShowForm(false);
      loadVault();
    } catch { showToast('保存失败', 'error'); }
  }

  async function handleDelete(key: string, alias: string) {
    let impactHtml = '';
    try {
      const imp = await checkKeyImpact(key);
      if (imp.projects && imp.projects.length > 0) {
        impactHtml = `<div style="margin-top:8px">以下 ${imp.projects.length} 个项目将失去该密钥引用：<br/>${imp.projects.map((p: string) => `- ${p}`).join('<br/>')}</div>`;
      }
    } catch {}
    const ok = await confirm(`确定删除 <strong>${key}</strong>？此操作不可撤销。${impactHtml}`);
    if (!ok) return;
    try {
      await deleteVault(key, alias);
      showToast('已删除');
      loadVault();
    } catch { showToast('删除失败', 'error'); }
  }

  async function handleCopy(key: string, alias: string) {
    try {
      const data = await getVaultValue(key, alias);
      await navigator.clipboard.writeText(data.value);
      showToast('已复制到剪贴板');
    } catch { showToast('复制失败', 'error'); }
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
        { label: '个人目录', path: home, icon: '🏠' },
        { label: '桌面', path: home + '/Desktop', icon: '🖥' },
        { label: '文档', path: home + '/Documents', icon: '📄' },
        { label: '下载', path: home + '/Downloads', icon: '📥' },
        { label: '根目录', path: '/', icon: '💾' },
      ]);
      setSyncDirs(data);
      setSyncPath(data.currentPath);
    } catch { showToast('加载目录失败', 'error'); }
  }

  async function browseDir(dir: string) {
    try {
      const data = await browseDirs(dir);
      setSyncDirs(data);
      setSyncPath(data.currentPath);
    } catch { showToast('加载目录失败', 'error'); }
  }

  async function confirmSync() {
    if (!syncPath) { showToast('请选择目录', 'error'); return; }
    try {
      const data = await syncToProject([{ key: syncKey, alias: 'default' }], syncPath);
      setShowSync(false);
      showToast(`已写入 ${data.synced} 个密钥`);
      loadVault();
    } catch { showToast('同步失败', 'error'); }
  }

  async function handleExport() {
    try {
      const blob = await exportVault();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'okit-vault-export.json'; a.click();
      URL.revokeObjectURL(url);
      showToast('导出文件已下载');
    } catch { showToast('导出失败', 'error'); }
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.secrets || !Array.isArray(data.secrets)) { showToast('无效的导出文件', 'error'); return; }
      const result = await importVault(data);
      showToast(`导入完成：${result.imported} 个新增，${result.skipped} 个跳过`);
      loadVault();
    } catch { showToast('文件解析失败', 'error'); }
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

  if (loading) return <div className="loading"><div className="loading-dots"><span></span><span></span><span></span></div>加载中...</div>;

  return (
    <div>
      {/* Toolbar */}
      <div className="vault-toolbar">
        <div className="vault-toolbar-left">
          <div className="search-paper">
            <input type="text" className="search-input" placeholder="搜索密钥..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          {groups.length > 0 && (
            <div className="filter-paper">
              <select className="filter-select" value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
                <option value="all">全部分组</option>
                {groups.map(g => <option key={g} value={g}>{g}</option>)}
                <option value="">未分组</option>
              </select>
            </div>
          )}
          <div className="vault-view-toggle">
            <button className={`vault-view-btn${viewMode === 'keys' ? ' active' : ''}`} onClick={() => setViewMode('keys')} title="密钥视图">🔑</button>
            <button className={`vault-view-btn${viewMode === 'projects' ? ' active' : ''}`} onClick={() => setViewMode('projects')} title="项目视图">📁</button>
          </div>
        </div>
        <div className="vault-toolbar-right">
          <button className="vault-toolbar-btn" onClick={openAddForm} title="添加密钥">
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 3v12M3 9h12" /></svg>
            <span>添加</span>
          </button>
          <button className="vault-toolbar-btn" onClick={handleExport} title="导出">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 10v2h10v-2M7 2v8M4 7l3 3 3-3" /></svg>
          </button>
          <button className="vault-toolbar-btn" onClick={() => importRef.current?.click()} title="导入">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 4v-2h10v2M7 12V5M4 8l3-3 3 3" /></svg>
          </button>
          <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) handleImport(e.target.files[0]); e.target.value = ''; }} />
          <button className="vault-toolbar-btn" onClick={() => loadVault()} title="刷新">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 7A5 5 0 1 1 7 2c1.4 0 2.6.6 3.5 1.5" /><path d="M12 2v3h-3" /></svg>
          </button>
        </div>
      </div>

      {/* Keys view */}
      {viewMode === 'keys' && (
        <div className="vault-list">
          {filtered.length === 0 && <div className="loading" style={{ padding: 40 }}>暂无密钥</div>}
          {filtered.map((secret, i) => {
            return (
              <div key={secret.key} className="vault-card">
                <div className="vault-card-body">
                  <div className="vault-card-row">
                    <span className="vault-key">{secret.key}</span>
                    <div className="vault-card-actions">
                      <button className="btn-icon btn-icon--copy" title="复制" onClick={() => handleCopy(secret.key, secret.aliases[0]?.alias || 'default')}>📋</button>
                      <button className="btn-icon" title="同步到项目" onClick={() => openSyncModal(secret.key, secret.aliases[0]?.alias || 'default')}>☁️</button>
                      <button className="btn-icon" title="编辑" onClick={() => openEditForm(secret)}>✏️</button>
                      <button className="btn-icon btn-icon--danger" title="删除" onClick={() => handleDelete(secret.key, secret.aliases[0]?.alias || 'default')}>🗑</button>
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
            );
          })}
        </div>
      )}

      {/* Projects view */}
      {viewMode === 'projects' && (
        <div className="vault-list">
          {Array.from(projectMap.map.entries()).map(([path, proj]) => (
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

      {/* Add/Edit form modal */}
      {showForm && (
        <div className="auth-overlay" style={{ display: '' }}>
          <div className="vault-form-panel">
            <div className="progress-header">
              <span className="progress-title">{editKey ? '编辑密钥' : '添加密钥'}</span>
              <button className="progress-close" onClick={() => setShowForm(false)}>&times;</button>
            </div>
            <div className="vault-form-body">
              <div className="vault-form-field">
                <label>Key</label>
                <input type="text" className="vault-input" placeholder="例如 OPENAI_API_KEY" value={formKey}
                  onChange={e => setFormKey(e.target.value)} disabled={!!editKey} />
              </div>
              <div className="vault-form-row">
                <div className="vault-form-field">
                  <label>别名</label>
                  <input type="text" className="vault-input" value={formAlias} onChange={e => setFormAlias(e.target.value)} disabled={!!editKey} />
                </div>
                <div className="vault-form-field">
                  <label>分组</label>
                  <select className="vault-input settings-select" value={formGroup} onChange={e => setFormGroup(e.target.value)}>
                    {groups.map(g => <option key={g} value={g}>{g}</option>)}
                    <option value="__custom__">手动输入...</option>
                  </select>
                  {formGroup === '__custom__' && (
                    <input type="text" className="vault-input" style={{ marginTop: 4 }} placeholder="输入分组名称" value={formGroupCustom} onChange={e => setFormGroupCustom(e.target.value)} />
                  )}
                </div>
              </div>
              <div className="vault-form-field vault-form-field--value">
                <label>Value</label>
                <input type={showValue ? 'text' : 'password'} className="vault-input" placeholder="密钥值" value={formValue} onChange={e => setFormValue(e.target.value)} />
                <button type="button" className="btn-toggle-vis" onClick={() => setShowValue(!showValue)}>{showValue ? '隐藏' : '显示'}</button>
              </div>
            </div>
            <div className="vault-form-actions">
              <button className="btn-cancel" onClick={() => setShowForm(false)}>取消</button>
              <button className="btn-save" onClick={handleSave}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Sync project modal */}
      {showSync && syncDirs && (
        <div className="auth-overlay" style={{ display: '' }}>
          <div className="sync-panel">
            <div className="progress-header">
              <span className="progress-title">同步密钥到项目</span>
              <button className="progress-close" onClick={() => setShowSync(false)}>&times;</button>
            </div>
            <div className="sync-body">
              <div className="sync-sidebar">
                <div className="sync-sidebar-label">快捷访问</div>
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
                  {syncDirs.dirs.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-muted)' }}>没有子目录</div>}
                </div>
              </div>
            </div>
            <div className="sync-footer">
              <span className="sync-selected-info">{syncPath}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-cancel" onClick={() => setShowSync(false)}>取消</button>
                <button className="btn-save" onClick={confirmSync}>确认同步</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
