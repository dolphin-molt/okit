import { useEffect, useState, useMemo } from 'react';
import { getTools, executeAction, openApp, type Tool } from '../../api/tools';
import { renderMd } from '../../lib/markdown';
import { useApp } from '../Layout/AppContext';

const TYPE_LABELS: Record<string, string> = { cli: '命令行工具', app: '桌面应用' };

export default function ToolsPage() {
  const { showToast, confirm, setConnectionStatus } = useApp();
  const [tools, setTools] = useState<Tool[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [detailTool, setDetailTool] = useState<Tool | null>(null);
  const [actioningTool, setActioningTool] = useState<string | null>(null);
  const [progressOutput, setProgressOutput] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['CLI']));

  useEffect(() => { loadTools(); }, []);

  async function loadTools() {
    setLoading(true);
    try {
      const data = await getTools();
      setTools(data.tools || []);
      setSummary(data.summary || {});
      setConnectionStatus('connected');
    } catch { setConnectionStatus('error'); } finally { setLoading(false); }
  }

  const typeGroups = useMemo(() => {
    const groups: Record<string, Record<string, number>> = {};
    for (const t of tools) {
      const type = (t as any).type === 'app' ? 'App' : 'CLI';
      const cat = (t as any).category || 'Other';
      if (!groups[type]) groups[type] = {};
      groups[type][cat] = (groups[type][cat] || 0) + 1;
    }
    return groups;
  }, [tools]);

  const filtered = useMemo(() => {
    return tools.filter(t => {
      if (categoryFilter !== 'all' && (t as any).category !== categoryFilter) return false;
      if (typeFilter !== 'all') {
        if (typeFilter === 'cli' && (t as any).type === 'app') return false;
        if (typeFilter === 'app' && (t as any).type !== 'app') return false;
      }
      if (statusFilter === 'installed' && t.status !== 'installed') return false;
      if (statusFilter === 'missing' && t.status === 'installed') return false;
      if (statusFilter === 'unauthorized' && (t as any).authStatus !== 'unauthorized' && (t as any).authStatus !== 'partial') return false;
      if (searchTerm && !t.name.toLowerCase().includes(searchTerm.toLowerCase()) && !t.description.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [tools, categoryFilter, typeFilter, statusFilter, searchTerm]);

  async function handleAction(name: string, action: string) {
    setActioningTool(name);
    setProgressOutput('');
    try {
      for await (const event of executeAction(name, action)) {
        if (event.type === 'output') setProgressOutput(prev => prev + (event.message || '') + '\n');
        if (event.type === 'auth_url' && (event as any).data) window.open((event as any).data, '_blank');
        if (event.type === 'success' || event.type === 'warning') {
          showToast(event.message || '操作完成', event.type === 'success' ? 'success' : 'info');
          loadTools();
          break;
        }
        if (event.type === 'error') { showToast(event.message || '操作失败', 'error'); break; }
      }
    } catch { showToast('操作失败', 'error'); } finally { setActioningTool(null); }
  }

  function toggleSelect(name: string) {
    setSelectedTools(prev => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next; });
  }
  function selectAll() { setSelectedTools(new Set(filtered.map(t => t.name))); }
  function clearSelection() { setSelectedTools(new Set()); }

  async function batchAction(action: string) {
    if (selectedTools.size === 0) return;
    const ok = await confirm(`确定对 ${selectedTools.size} 个工具执行<strong>${action}</strong>操作？`);
    if (!ok) return;
    for (const name of selectedTools) await handleAction(name, action);
    clearSelection();
  }

  function sidebarFilter(type: string, category: string) {
    setTypeFilter(type === 'all' ? 'all' : type.toLowerCase());
    setCategoryFilter(category);
    if (type !== 'all') setExpandedGroups(prev => new Set(prev).add(type));
  }

  function toggleCatGroup(type: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }

  if (loading) return <div className="loading"><div className="loading-dots"><span></span><span></span><span></span></div>正在检查工具状态...</div>;

  // ─── Detail view ───
  if (detailTool) {
    return (
      <div className="tool-detail-page">
        <button className="detail-back" onClick={() => setDetailTool(null)}>
          ← 返回列表
        </button>
        <div className="detail-hero">
          <div className="detail-hero-body">
            <h2 className="detail-hero-name">{detailTool.name}</h2>
            <div className="detail-hero-cat">{(detailTool as any).category}</div>
            <div className="detail-hero-actions">
              {detailTool.status !== 'installed' && (
                <button className="btn-action btn-action--install" disabled={actioningTool === detailTool.name}
                  onClick={() => handleAction(detailTool.name, 'install')}>
                  {actioningTool === detailTool.name ? '安装中...' : '安装'}
                </button>
              )}
              {(detailTool as any).hasUpgrade && (
                <button className="btn-action btn-action--upgrade" disabled={actioningTool === detailTool.name}
                  onClick={() => handleAction(detailTool.name, 'upgrade')}>升级</button>
              )}
              {detailTool.status === 'installed' && (
                <>
                  <button className="btn-action btn-action--uninstall" disabled={actioningTool === detailTool.name}
                    onClick={() => handleAction(detailTool.name, 'uninstall')}>卸载</button>
                  <button className="btn-action btn-action--open" onClick={() => openApp(detailTool.name)}>打开</button>
                </>
              )}
              {(detailTool as any).hasAuth && (
                <button className="btn-action btn-action--auth" onClick={() => handleAction(detailTool.name, 'auth')}>授权</button>
              )}
            </div>
          </div>
        </div>

        <p className="detail-page-desc">{detailTool.description}</p>

        {(detailTool as any).detail && (
          <div className="detail-info-card detail-md-card">
            <div className="detail-md" dangerouslySetInnerHTML={{ __html: renderMd((detailTool as any).detail) }} />
          </div>
        )}

        <div className="detail-info-card">
          <div className="detail-info-title">信息</div>
          <div className="detail-row">
            <span className="detail-row-label">状态</span>
            <span className={`detail-row-value ${detailTool.status === 'installed' ? 'detail-ok' : 'detail-fail'}`}>
              {detailTool.status === 'installed' ? '已安装' : '未安装'}
            </span>
          </div>
          {detailTool.version && (
            <div className="detail-row">
              <span className="detail-row-label">版本</span>
              <span className="detail-row-value detail-mono">{detailTool.version}</span>
            </div>
          )}
          {(detailTool as any).homepage && (
            <div className="detail-row">
              <span className="detail-row-label">官网</span>
              <a className="detail-link" href={(detailTool as any).homepage} target="_blank" rel="noopener">
                {(detailTool as any).homepage}
              </a>
            </div>
          )}
          {(detailTool as any).authStatus && (detailTool as any).authStatus !== 'na' && (
            <div className="detail-row">
              <span className="detail-row-label">授权</span>
              <span className={`detail-row-value ${(detailTool as any).authStatus === 'authorized' ? 'detail-ok' : 'detail-fail'}`}>
                {(detailTool as any).authStatus === 'authorized' ? '已授权' : '未授权'}
              </span>
            </div>
          )}
        </div>

        {actioningTool === detailTool.name && progressOutput && (
          <div className="detail-info-card">
            <pre className="md-pre"><code className="md-code">{progressOutput}</code></pre>
          </div>
        )}
      </div>
    );
  }

  // ─── List view ───
  return (
    <div className="tools-layout">
      <nav className="tools-cat-sidebar">
        <div className="cat-sidebar-title">分类</div>
        <div className="cat-sidebar-body">
          <div className={`cat-sidebar-item${typeFilter === 'all' && categoryFilter === 'all' ? ' active' : ''}`}
            onClick={() => sidebarFilter('all', 'all')}>
            <span className="cat-sidebar-label">全部工具</span>
            <span className="cat-sidebar-count">{tools.length}</span>
          </div>
          {Object.entries(typeGroups).map(([type, categories]) => {
            const cats = Object.entries(categories).sort((a, b) => a[0].localeCompare(b[0]));
            const typeCount = cats.reduce((sum, [, c]) => sum + c, 0);
            if (typeCount === 0) return null;
            const isActive = typeFilter === type.toLowerCase() && categoryFilter === 'all';
            const isExpanded = expandedGroups.has(type);
            return (
              <div key={type} className="cat-group">
                <div className={`cat-group-header${isActive ? ' active' : ''}`} onClick={() => sidebarFilter(type, 'all')}>
                  <span className={`cat-group-arrow${isExpanded ? ' expanded' : ''}`}
                    onClick={e => { e.stopPropagation(); toggleCatGroup(type); }}>&#9656;</span>
                  <span className="cat-group-label">{TYPE_LABELS[type.toLowerCase()] || type}</span>
                  <span className="cat-group-count">{typeCount}</span>
                </div>
                <div className={`cat-group-items${isExpanded ? '' : ' collapsed'}`}>
                  {cats.map(([cat, count]) => (
                    <div key={cat}
                      className={`cat-item${typeFilter === type.toLowerCase() && categoryFilter === cat ? ' active' : ''}`}
                      onClick={() => sidebarFilter(type, cat)}>
                      <span className="cat-item-label">{cat}</span>
                      <span className="cat-item-count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </nav>

      <div className="tools-main">
        <header className="page-header">
          <button className="btn-refresh" onClick={() => { setLoading(true); loadTools(); }} title="刷新">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 7A5 5 0 1 1 7 2c1.4 0 2.6.6 3.5 1.5" /><path d="M12 2v3h-3" />
            </svg>
          </button>
        </header>

        <div className="summary">
          <div className="summary-card">
            <span className="summary-num">{summary.installed || 0}</span>
            <span className="summary-label">已安装</span>
          </div>
          <div className="summary-card">
            <span className="summary-num">{summary.total || tools.length}</span>
            <span className="summary-label">总计</span>
          </div>
          {(summary.unauthorized || 0) > 0 && (
            <div className="summary-card">
              <span className="summary-num">{summary.unauthorized}</span>
              <span className="summary-label">未授权</span>
            </div>
          )}
        </div>

        <div className="toolbar">
          <div className="search-paper">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4">
              <circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" />
            </svg>
            <input type="text" className="search-input" placeholder="搜索工具..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </div>

        <div className="filter-bar">
          <div className="status-filters">
            {(['all', 'installed', 'missing', 'unauthorized'] as const).map(s => (
              <button key={s} className={`status-filter${statusFilter === s ? ' active' : ''}`} onClick={() => setStatusFilter(s)}>
                {s === 'all' ? '全部' : s === 'installed' ? '已安装' : s === 'missing' ? '未安装' : '未授权'}
              </button>
            ))}
          </div>
          <button className="btn-select-all" onClick={selectedTools.size > 0 ? clearSelection : selectAll}>
            {selectedTools.size > 0 ? '取消' : '全选'}
          </button>
        </div>

        <div className="tool-list">
          {filtered.length === 0 && <div className="loading" style={{ padding: 40 }}>没有匹配的工具</div>}
          {filtered.map(tool => {
            const isSelected = selectedTools.has(tool.name);
            const isInstalled = tool.status === 'installed';
            return (
              <div key={tool.name} className={`tool-card${isSelected ? ' tool-card--selected' : ''}`}>
                <div className="tool-card-body">
                  <div className="tool-card-row">
                    <div className="tool-card-name-wrap">
                      <label className={`tool-select${isSelected ? ' selected' : ''}`} onClick={e => { e.stopPropagation(); toggleSelect(tool.name); }}>
                        <input type="checkbox" checked={isSelected} readOnly style={{ display: 'none' }} />
                        {isSelected ? '✓' : ''}
                      </label>
                      <span className="tool-name" onClick={() => setDetailTool(tool)}>{tool.name}</span>
                      {tool.version && <span className="tool-version">{tool.version}</span>}
                      {(tool as any).type === 'app' && <span className="tool-type-badge">App</span>}
                    </div>
                    <div className="tool-card-meta">
                      <span className={`tool-status ${isInstalled ? 'installed' : 'missing'}`}>
                        {isInstalled ? '已安装' : '未安装'}
                      </span>
                      {(tool as any).authStatus === 'unauthorized' && <span className="tool-auth fail">未授权</span>}
                      {(tool as any).authStatus === 'authorized' && <span className="tool-auth ok">已授权</span>}
                    </div>
                  </div>
                  <div className="tool-desc" style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
                    {tool.description}
                  </div>
                  <div className="tool-card-actions">
                    {!isInstalled && (
                      <button className="btn-action btn-action--install" disabled={actioningTool === tool.name}
                        onClick={() => handleAction(tool.name, 'install')}>
                        {actioningTool === tool.name ? '安装中...' : '安装'}
                      </button>
                    )}
                    {isInstalled && (tool as any).hasUpgrade && (
                      <button className="btn-action btn-action--upgrade" disabled={actioningTool === tool.name}
                        onClick={() => handleAction(tool.name, 'upgrade')}>升级</button>
                    )}
                    {isInstalled && (
                      <>
                        <button className="btn-action btn-action--open" onClick={() => openApp(tool.name)}>打开</button>
                        <button className="btn-action btn-action--uninstall" disabled={actioningTool === tool.name}
                          onClick={() => handleAction(tool.name, 'uninstall')}>卸载</button>
                      </>
                    )}
                    {(tool as any).hasAuth && (tool as any).authStatus !== 'authorized' && (
                      <button className="btn-action btn-action--auth" onClick={() => handleAction(tool.name, 'auth')}>授权</button>
                    )}
                    <button className="btn-action" onClick={() => setDetailTool(tool)}>详情</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {selectedTools.size > 0 && (
          <div id="batchBar" className="batch-bar">
            <div className="batch-bar-inner">
              <span className="batch-info">已选 <strong>{selectedTools.size}</strong> 项</span>
              <button className="btn-batch btn-batch--install" onClick={() => batchAction('install')}>批量安装</button>
              <button className="btn-batch btn-batch--upgrade" onClick={() => batchAction('upgrade')}>批量升级</button>
              <button className="btn-batch btn-batch--uninstall" onClick={() => batchAction('uninstall')}>批量卸载</button>
              <button className="btn-batch-cancel" onClick={clearSelection}>取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
