import { useEffect, useState } from 'react';
import { getLogs } from '../../api/logs';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

export default function LogsPage() {
  const { setConnectionStatus } = useApp();
  const { t } = useI18n();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

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

  function toggleRow(i: number) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
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

  if (loading) return <div className="loading"><div className="loading-dots"><span></span><span></span><span></span></div>{t('common.loading')}</div>;

  return (
    <div className="log-table-wrap">
      <table className="log-table">
        <thead>
          <tr>
            <th className="log-th-status">{t('logs.status')}</th>
            <th className="log-th-name">{t('logs.tool')}</th>
            <th className="log-th-action">{t('logs.action')}</th>
            <th className="log-th-time">{t('logs.time')}</th>
            <th className="log-th-duration">{t('logs.duration')}</th>
            <th className="log-th-output">{t('logs.detail')}</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 ? (
            <tr><td colSpan={6} className="log-empty">{t('logs.noRecords')}</td></tr>
          ) : logs.map((log, i) => {
            const outputText = log.output || log.message || '';
            const command = log.command || '';
            const hasContent = command || outputText;
            const isExpanded = expandedRows.has(i);
            return (
              <>
                <tr key={i} className={`log-row${log.success ? '' : ' log-row-fail'}${isExpanded ? ' log-row--expanded' : ''}`}>
                  <td className="log-td-status">
                    <span className={`log-dot ${log.success ? 'log-dot-ok' : 'log-dot-fail'}`}>{log.success ? '✓' : '✗'}</span>
                  </td>
                  <td className="log-td-name">{log.name}</td>
                  <td className="log-td-action">
                    <span className={`log-action-tag log-action-${log.action}`}>{actionLabels[log.action] || log.action}</span>
                  </td>
                  <td className="log-td-time">{formatTime(log.timestamp)}</td>
                  <td className="log-td-duration">{formatDuration(log.duration)}</td>
                  <td className="log-td-output">
                    {hasContent ? (
                      <span className="log-expand-trigger" onClick={() => toggleRow(i)}>
                        <span className="log-output-preview">{command ? truncate(command) : truncate(outputText)}</span>
                        <span className="log-expand-icon">{isExpanded ? '▲' : '▼'}</span>
                      </span>
                    ) : <span className="log-output-text">-</span>}
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${i}-detail`} className="log-detail-row">
                    <td colSpan={6} className="log-detail-cell">
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
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
