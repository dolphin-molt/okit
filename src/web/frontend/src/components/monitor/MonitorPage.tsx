import { useEffect, useState, useRef } from 'react';
import { getMonitor, getDu, scanCleanup, deleteCleanupItems, aiCleanup, type SystemStats, type DuEntry } from '../../api/monitor';
import { formatBytes, formatUptime, barColor } from '../../lib/utils';
import { useApp } from '../Layout/AppContext';

export default function MonitorPage() {
  const { showToast, confirm, setConnectionStatus } = useApp();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [diskTab, setDiskTab] = useState<'overview' | 'cleanup' | 'ai'>('overview');
  const [duPath, setDuPath] = useState('~');
  const [duItems, setDuItems] = useState<DuEntry[]>([]);
  const [duBreadcrumbs, setDuBreadcrumbs] = useState<string[]>([]);
  const [cleanupItems, setCleanupItems] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [diskSummary, setDiskSummary] = useState<any>(null);
  const [aiMessages, setAiMessages] = useState<any[]>([]);
  const [aiStreaming, setAiStreaming] = useState(false);
  const aiTextRef = useRef('');

  useEffect(() => { loadMonitor(); }, []);

  async function loadMonitor() {
    setLoading(true);
    try {
      const data = await getMonitor();
      setStats(data);
      setConnectionStatus('connected');
    } catch { setConnectionStatus('error'); } finally { setLoading(false); }
  }

  async function startDiskScan() {
    setScanning(true);
    setCleanupItems([]);
    setScanDone(false);
    try {
      for await (const item of scanCleanup()) {
        if ((item as any).type === 'diskInfo') { setDiskSummary((item as any).data); continue; }
        if ((item as any).type === 'summary') { setDiskSummary((prev: any) => ({ ...prev, ...item })); continue; }
        setCleanupItems(prev => [...prev, item]);
      }
      setScanDone(true);
    } catch { showToast('扫描失败', 'error'); } finally { setScanning(false); }
  }

  async function loadDu() {
    try {
      const data = await getDu(duPath);
      setDuItems(Array.isArray(data) ? data : []);
      const parts = duPath.replace(/^~/, '').split('/').filter(Boolean);
      setDuBreadcrumbs(parts);
    } catch { showToast('扫描路径失败', 'error'); }
  }

  async function handleDeleteCleanup(idx: number) {
    const item = cleanupItems[idx];
    if (!item) return;
    const ok = await confirm(`确定删除 <strong>${item.path}</strong>（${formatBytes(item.size)}）？`);
    if (!ok) return;
    try {
      await deleteCleanupItems([item.path]);
      setCleanupItems(prev => prev.filter((_, i) => i !== idx));
      showToast('已删除');
    } catch { showToast('删除失败', 'error'); }
  }

  async function startAiCleanup() {
    setAiStreaming(true);
    setAiMessages([]);
    aiTextRef.current = '';
    try {
      for await (const event of aiCleanup('分析磁盘空间使用情况并给出清理建议')) {
        if ((event as any).type === 'text') {
          aiTextRef.current += (event as any).content || '';
          setAiMessages(prev => {
            const next = [...prev];
            if (next.length && next[next.length - 1].type === 'text') {
              next[next.length - 1] = { type: 'text', content: aiTextRef.current };
              return next;
            }
            return [...prev, { type: 'text', content: aiTextRef.current }];
          });
        } else {
          setAiMessages(prev => [...prev, event]);
          if ((event as any).type === 'text') aiTextRef.current = '';
        }
      }
    } catch { showToast('AI 分析失败', 'error'); } finally { setAiStreaming(false); }
  }

  if (loading || !stats) return <div className="loading"><div className="loading-dots"><span></span><span></span><span></span></div>加载中...</div>;

  const { cpu, memory, disk, gpu, uptime } = stats;
  const memPct = Math.round(memory.usagePercent);
  const rootDisk = disk.find((d: any) => d.mount === '/') || disk[0];
  const diskCap = rootDisk ? parseInt(rootDisk.capacity) : 0;
  const gpuArr = Array.isArray(gpu) ? gpu : gpu ? [gpu] : [];

  return (
    <div>
      {/* System metrics */}
      <div className="monitor-grid">
        <MetricCard label="CPU" value={`${cpu.usage}%`} detail={`${cpu.cores} 核 · ${cpu.model}`} pct={cpu.usage} color="#3b82f6" />
        <MetricCard label="内存" value={`${memPct}%`} detail={`${formatBytes(memory.used)} / ${formatBytes(memory.total)}`} pct={memPct} color="#8b5cf6" />
        {rootDisk && <MetricCard label="磁盘" value={rootDisk.capacity} detail={`${rootDisk.used} / ${rootDisk.size}`} pct={diskCap} color="#f59e0b" />}
        <MetricCard label="运行时间" value={formatUptime(uptime)} detail="" pct={0} color="#16a34a" />
        {gpuArr.map((g: any, i: number) => (
          <MetricCard key={i} label={`GPU ${i + 1}`} value={g.vram || `${g.usage}%`} detail={g.model || g.name} pct={g.usage || 0} color="#ec4899" />
        ))}
      </div>

      {/* Disk section */}
      <div className="monitor-section">
        <div className="disk-header">
          <h3 className="monitor-section-title">磁盘空间</h3>
          <button className="btn-action" onClick={startDiskScan} disabled={scanning}>
            {scanning ? '扫描中...' : '扫描磁盘'}
          </button>
        </div>

        {diskSummary && (
          <>
            <div className="disk-tabs">
              {(['overview', 'cleanup', 'ai'] as const).map(tab => (
                <button key={tab} className={`disk-tab${diskTab === tab ? ' active' : ''}`} onClick={() => setDiskTab(tab)}>
                  {tab === 'overview' ? '占用分布' : tab === 'cleanup' ? '清理建议' : 'AI 分析'}
                </button>
              ))}
            </div>

            {diskTab === 'overview' && (
              <div className="disk-tab-content">
                <div className="du-bar">
                  <div className="search-paper" style={{ flex: 1 }}>
                    <input type="text" className="search-input" placeholder="输入路径" value={duPath}
                      onChange={e => setDuPath(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadDu()} />
                  </div>
                  <button className="btn-action" onClick={loadDu} style={{ whiteSpace: 'nowrap' }}>扫描</button>
                </div>
                <div className="du-list">
                  {duItems.map((item, i) => (
                    <div key={i} className="du-item" onClick={() => { setDuPath(item.path); loadDu(); }}>
                      <span className="du-name">{item.path.split('/').pop()}</span>
                      <span className="du-size">{formatBytes(item.size)}</span>
                    </div>
                  ))}
                  {duItems.length === 0 && <div className="loading" style={{ padding: 32 }}>扫描后查看占用分布</div>}
                </div>
              </div>
            )}

            {diskTab === 'cleanup' && (
              <div className="disk-tab-content">
                {scanning && <div className="loading">扫描中，已发现 {cleanupItems.length} 项...</div>}
                {cleanupItems.map((item, i) => (
                  <div key={i} className="cleanup-item">
                    <div className="cleanup-item-info">
                      <span className="cleanup-category">{item.category}</span>
                      <span className="cleanup-path">{item.path}</span>
                      <span className="cleanup-size">{formatBytes(item.size)}</span>
                    </div>
                    <button className="btn-outline" onClick={() => handleDeleteCleanup(i)}>删除</button>
                  </div>
                ))}
                {!scanning && cleanupItems.length === 0 && <div className="loading" style={{ padding: 32 }}>点击「扫描磁盘」开始</div>}
              </div>
            )}

            {diskTab === 'ai' && (
              <div className="disk-tab-content">
                <div style={{ marginBottom: 12 }}>
                  <button className="btn-action btn-action--ai" onClick={startAiCleanup} disabled={aiStreaming}>
                    {aiStreaming ? '分析中...' : '开始 AI 清理'}
                  </button>
                </div>
                <div className="ai-suggestions">
                  <div className="ai-header">AI 空间优化建议</div>
                  <div className="ai-body">
                    {aiMessages.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-muted)' }}>点击「开始 AI 清理」启动智能清理</div>}
                    {aiMessages.map((msg, i) => (
                      <div key={i} className={`ai-msg ai-msg--${msg.type}`}>
                        {msg.type === 'text' && <div dangerouslySetInnerHTML={{ __html: msg.content }} />}
                        {msg.type === 'tool_call' && <div className="ai-tool-call">调用: {msg.name}</div>}
                        {msg.type === 'tool_result' && <div className={`ai-tool-result ${msg.status}`}>结果: {msg.status}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail, pct, color }: { label: string; value: string; detail: string; pct: number; color: string }) {
  return (
    <div className="monitor-card">
      <div className="monitor-card-label">{label}</div>
      <div className="monitor-card-value" style={{ color }}>{value}</div>
      {detail && <div className="monitor-card-detail">{detail}</div>}
      {pct > 0 && (
        <div className="monitor-bar-wrap">
          <div className="monitor-bar" style={{ width: `${Math.min(pct, 100)}%`, background: barColor(pct) }} />
        </div>
      )}
    </div>
  );
}
