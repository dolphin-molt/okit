import { Fragment, useEffect, useMemo, useState } from 'react';
import { getLogs } from '../../api/logs';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

export default function LogsPage() {
  const { setConnectionStatus } = useApp();
  const { t } = useI18n();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const actionLabels: Record<string, string> = {
    install: t('logs.actionInstall'),
    upgrade: t('logs.actionUpgrade'),
    uninstall: t('logs.actionUninstall'),
    auth: t('logs.actionAuth'),
    open: t('logs.actionOpen'),
  };

  useEffect(() => { loadLogs(); }, []);

  async function loadLogs() {
    setLoading(true);
    try {
      const data = await getLogs();
      setLogs(data);
      setConnectionStatus('connected');
    } catch { setConnectionStatus('error'); } finally { setLoading(false); }
  }

  function getLogKey(log: any, i: number) {
    return `${log.timestamp || 'log'}-${log.name || 'tool'}-${i}`;
  }

  function toggleRow(key: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function formatTime(ts: string) {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatDuration(ms: number | undefined) {
    if (!ms) return '-';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  function truncate(s: string, n = 80) {
    return s.length > n ? s.slice(0, n) + '...' : s;
  }

  const logStats = useMemo(() => {
    const failed = logs.filter(log => !log.success).length;
    const uniqueTools = new Set(logs.map(log => log.name).filter(Boolean)).size;
    const avgDuration = logs.length
      ? Math.round(logs.reduce((sum, log) => sum + (log.duration || 0), 0) / logs.length)
      : 0;
    return { failed, uniqueTools, avgDuration };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(log => {
      const text = [
        log.name,
        log.action,
        log.timestamp,
        log.duration,
        log.command,
        log.output,
        log.message,
        log.success ? t('common.success') : t('common.failed'),
      ].filter(Boolean).join(' ').toLowerCase();
      return text.includes(q);
    });
  }, [logs, searchTerm, t]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const resultStart = filteredLogs.length ? (currentPage - 1) * pageSize + 1 : 0;
  const resultEnd = Math.min(currentPage * pageSize, filteredLogs.length);

  if (loading) return <div className="loading"><div className="loading-dots"><span></span><span></span><span></span></div>{t('common.loading')}</div>;

  return (
    <div className="access-workspace logs-workspace">
      <header className="access-hero">
        <div className="access-hero-copy">
          <h1>{t('logs.title')}</h1>
          <p>{t('logs.lede')}</p>
        </div>
        <div className="access-hero-stats" aria-label="Log summary">
          <div><span>{t('common.total')}</span><strong>{logs.length}</strong></div>
          <div><span>{t('logs.failed')}</span><strong>{logStats.failed}</strong></div>
          <div><span>{t('logs.toolsTouched')}</span><strong>{logStats.uniqueTools}</strong></div>
          <div><span>{t('logs.avgDuration')}</span><strong>{formatDuration(logStats.avgDuration)}</strong></div>
        </div>
      </header>

      <div className="logs-search-panel">
        <div className="logs-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.55">
            <circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" />
          </svg>
          <input
            type="text"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
            placeholder={t('logs.searchPlaceholder')}
          />
        </div>
      </div>

      <div className="log-table-wrap">
        <table className="log-table">
        <thead>
          <tr>
            <th className="log-th-status">{t('logs.status')}</th>
            <th className="log-th-detail">{t('logs.detail')}</th>
            <th className="log-th-name">{t('logs.tool')}</th>
            <th className="log-th-action">{t('logs.action')}</th>
            <th className="log-th-time">{t('logs.time')}</th>
            <th className="log-th-duration">{t('logs.duration')}</th>
            <th className="log-th-command">{t('logs.command')}</th>
            <th className="log-th-output">{t('logs.output')}</th>
          </tr>
        </thead>
        <tbody>
          {filteredLogs.length === 0 ? (
            <tr><td colSpan={8} className="log-empty">{t('logs.noRecords')}</td></tr>
          ) : paginatedLogs.map((log, i) => {
            const absoluteIndex = (currentPage - 1) * pageSize + i;
            const outputText = log.output || log.message || '';
            const command = log.command || '';
            const hasContent = command || outputText;
            const rowKey = getLogKey(log, absoluteIndex);
            const isExpanded = expandedRows.has(rowKey);
            return (
              <Fragment key={rowKey}>
                <tr className={`log-row${log.success ? '' : ' log-row-fail'}${isExpanded ? ' log-row--expanded' : ''}`}>
                  <td className="log-td-status">
                    <span className={`log-dot ${log.success ? 'log-dot-ok' : 'log-dot-fail'}`}>{log.success ? '✓' : '✗'}</span>
                  </td>
                  <td className="log-td-detail">
                    {hasContent ? (
                      <button className="log-expand-trigger" onClick={() => toggleRow(rowKey)}>
                        <span className="log-output-preview">{isExpanded ? t('common.hide') : t('common.show')}</span>
                        <span className="log-expand-icon">{isExpanded ? '▲' : '▼'}</span>
                      </button>
                    ) : <span className="log-output-text">-</span>}
                  </td>
                  <td className="log-td-name">{log.name}</td>
                  <td className="log-td-action">
                    <span className={`log-action-tag log-action-${log.action}`}>{actionLabels[log.action] || log.action}</span>
                  </td>
                  <td className="log-td-time">{formatTime(log.timestamp)}</td>
                  <td className="log-td-duration">{formatDuration(log.duration)}</td>
                  <td className="log-td-command">{command ? truncate(command, 54) : '-'}</td>
                  <td className="log-td-output">
                    {outputText ? truncate(outputText, 54) : '-'}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="log-detail-row">
                    <td colSpan={8} className="log-detail-cell">
                      <div className="log-detail-content">
                        {command && (
                          <div className="log-detail-section">
                            <div className="log-detail-label">{t('logs.command')}</div>
                            <code className="log-detail-code">{command}</code>
                          </div>
                        )}
                        {outputText && (
                          <div className="log-detail-section">
                            <div className="log-detail-label">{t('logs.output')}</div>
                            <pre className="log-detail-pre">{outputText}</pre>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        </table>
      </div>

      <div className="logs-pagination">
        <div>{t('logs.showing', { start: resultStart, end: resultEnd, total: filteredLogs.length })}</div>
        <div className="logs-pagination-actions">
          <label className="logs-page-size">
            <span>{t('logs.pageSize')}</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {[10, 20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>{t('logs.prev')}</button>
          <span>{currentPage} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>{t('logs.next')}</button>
        </div>
      </div>
    </div>
  );
}
