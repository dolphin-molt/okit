import { useEffect, useState, useRef } from 'react';
import { getMonitor, getDu, scanCleanup, deleteCleanupItems, aiCleanup, type SystemStats, type DuEntry } from '../../api/monitor';
import { formatBytes, formatUptime, barColor } from '../../lib/utils';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

export default function MonitorPage() {
  const { showToast, confirm, setConnectionStatus } = useApp();
  const { t } = useI18n();
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
    } catch { showToast(t('monitor.scanFail'), 'error'); } finally { setScanning(false); }
  }

  async function loadDu() {
    try {
      const data = await getDu(duPath);
      setDuItems(Array.isArray(data) ? data : []);
      const parts = duPath.replace(/^~/, '').split('/').filter(Boolean);
      setDuBreadcrumbs(parts);
    } catch { showToast(t('monitor.scanPathFail'), 'error'); }
  }

  async function handleDeleteCleanup(idx: number) {
    const item = cleanupItems[idx];
    if (!item) return;
    const ok = await confirm(t('monitor.confirmDelete', { path: item.path, size: formatBytes(item.size) }));
    if (!ok) return;
    try {
      await deleteCleanupItems([item.path]);
      setCleanupItems(prev => prev.filter((_, i) => i !== idx));
      showToast(t('common.copied'));
    } catch { showToast(t('common.failed'), 'error'); }
  }

  async function startAiCleanup() {
    setAiStreaming(true);
    setAiMessages([]);
    aiTextRef.current = '';
    try {
      for await (const event of aiCleanup(t('monitor.analyzeDesc'))) {
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
    } catch { showToast(t('monitor.aiFail'), 'error'); } finally { setAiStreaming(false); }
  }

  if (loading || !stats) return <div className="loading"><div className="loading-dots"><span></span><span></span><span></span></div>{t('common.loading')}</div>;

  const { cpu, memory, disk, gpu, uptime } = stats;
  const memPct = Math.round(memory.usagePercent);
  const rootDisk = disk.find((d: any) => d.mount === '/') || disk[0];
  const diskCap = rootDisk ? parseInt(rootDisk.capacity) : 0;
  const gpuArr = Array.isArray(gpu) ? gpu : gpu ? [gpu] : [];

  return (
    <div className="access-workspace monitor-workspace">
      <header className="access-hero">
        <div className="access-hero-copy">
          <h1>{t('monitor.title')}</h1>
          <p>{t('monitor.lede')}</p>
        </div>
        <div className="access-hero-stats" aria-label="System monitor summary">
          <div><span>{t('monitor.cpu')}</span><strong>{cpu.usage}%</strong></div>
          <div><span>{t('monitor.memory')}</span><strong>{memPct}%</strong></div>
          <div><span>{t('monitor.disk')}</span><strong>{rootDisk?.capacity || '-'}</strong></div>
          <div><span>{t('monitor.uptime')}</span><strong>{formatUptime(uptime)}</strong></div>
        </div>
      </header>

      {/* System metrics */}
      <div className="monitor-grid">
        <MetricCard label={t('monitor.cpu')} value={`${cpu.usage}%`} detail={`${cpu.cores} ${t('monitor.cpu').toLowerCase()} · ${cpu.model}`} pct={cpu.usage} color="#3b82f6" />
        <MetricCard label={t('monitor.memory')} value={`${memPct}%`} detail={`${formatBytes(memory.used)} / ${formatBytes(memory.total)}`} pct={memPct} color="#8b5cf6" />
        {rootDisk && <MetricCard label={t('monitor.disk')} value={rootDisk.capacity} detail={`${rootDisk.used} / ${rootDisk.size}`} pct={diskCap} color="#f59e0b" />}
        <MetricCard label={t('monitor.uptime')} value={formatUptime(uptime)} detail="" pct={0} color="#16a34a" />
        {gpuArr.map((g: any, i: number) => (
          <MetricCard key={i} label={`GPU ${i + 1}`} value={g.vram || `${g.usage}%`} detail={g.model || g.name} pct={g.usage || 0} color="#ec4899" />
        ))}
      </div>

      {/* Disk section */}
      <div className="monitor-section">
        <div className="disk-header">
          <h3 className="monitor-section-title">{t('monitor.diskSpace')}</h3>
          <button className="btn-action" onClick={startDiskScan} disabled={scanning}>
            {scanning ? t('common.scanning') : t('monitor.scanDisk')}
          </button>
        </div>

        {diskSummary && (
          <>
            <div className="disk-tabs">
              {(['overview', 'cleanup', 'ai'] as const).map(tab => (
                <button key={tab} className={`disk-tab${diskTab === tab ? ' active' : ''}`} onClick={() => setDiskTab(tab)}>
                  {tab === 'overview' ? t('monitor.distribution') : tab === 'cleanup' ? t('monitor.cleanupSuggestion') : t('monitor.aiAnalysis')}
                </button>
              ))}
            </div>

            {diskTab === 'overview' && (
              <div className="disk-tab-content">
                <div className="du-bar">
                  <div className="search-paper" style={{ flex: 1 }}>
                    <input type="text" className="search-input" placeholder={t('monitor.enterPath')} value={duPath}
                      onChange={e => setDuPath(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadDu()} />
                  </div>
                  <button className="btn-action" onClick={loadDu} style={{ whiteSpace: 'nowrap' }}>{t('common.scan')}</button>
                </div>
                <div className="du-list">
                  {duItems.map((item, i) => (
                    <div key={i} className="du-item" onClick={() => { setDuPath(item.path); loadDu(); }}>
                      <span className="du-name">{item.path.split('/').pop()}</span>
                      <span className="du-size">{formatBytes(item.size)}</span>
                    </div>
                  ))}
                  {duItems.length === 0 && <div className="loading" style={{ padding: 32 }}>{t('monitor.viewAfterScan')}</div>}
                </div>
              </div>
            )}

            {diskTab === 'cleanup' && (
              <div className="disk-tab-content">
                {scanning && <div className="loading">{t('monitor.scanningFound', { n: cleanupItems.length })}</div>}
                {cleanupItems.map((item, i) => (
                  <div key={i} className="cleanup-item">
                    <div className="cleanup-item-info">
                      <span className="cleanup-category">{item.category}</span>
                      <span className="cleanup-path">{item.path}</span>
                      <span className="cleanup-size">{formatBytes(item.size)}</span>
                    </div>
                    <button className="btn-outline" onClick={() => handleDeleteCleanup(i)}>{t('common.delete')}</button>
                  </div>
                ))}
                {!scanning && cleanupItems.length === 0 && <div className="loading" style={{ padding: 32 }}>{t('monitor.clickToStart')}</div>}
              </div>
            )}

            {diskTab === 'ai' && (
              <div className="disk-tab-content">
                <div style={{ marginBottom: 12 }}>
                  <button className="btn-action btn-action--ai" onClick={startAiCleanup} disabled={aiStreaming}>
                    {aiStreaming ? t('monitor.analyzing') : t('monitor.startAICleanup')}
                  </button>
                </div>
                <div className="ai-suggestions">
                  <div className="ai-header">{t('monitor.aiSuggestion')}</div>
                  <div className="ai-body">
                    {aiMessages.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-muted)' }}>{t('monitor.aiCleanupDesc')}</div>}
                    {aiMessages.map((msg, i) => (
                      <div key={i} className={`ai-msg ai-msg--${msg.type}`}>
                        {msg.type === 'text' && <div dangerouslySetInnerHTML={{ __html: msg.content }} />}
                        {msg.type === 'tool_call' && <div className="ai-tool-call">{t('monitor.call')}{msg.name}</div>}
                        {msg.type === 'tool_result' && <div className={`ai-tool-result ${msg.status}`}>{t('monitor.result')}{msg.status}</div>}
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
