import { useEffect, useState } from 'react';
import { getLogs } from '../../api/logs';
import { useApp } from '../Layout/AppContext';

const ACTION_LABELS: Record<string, string> = { install: '安装', upgrade: '升级', uninstall: '卸载', auth: '授权', open: '打开' };

export default function LogsPage() {
  const { setConnectionStatus } = useApp();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

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

  if (loading) return <div className="loading"><div className="loading-dots"><span></span><span></span><span></span></div>加载中...</div>;

  return (
    <div className="log-table-wrap">
      <table className="log-table">
        <thead>
          <tr>
            <th className="log-th-status">状态</th>
            <th className="log-th-name">工具</th>
            <th className="log-th-action">操作</th>
            <th className="log-th-time">时间</th>
            <th className="log-th-duration">耗时</th>
            <th className="log-th-output">详情</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 ? (
            <tr><td colSpan={6} className="log-empty">暂无操作记录</td></tr>
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
                    <span className={`log-action-tag log-action-${log.action}`}>{ACTION_LABELS[log.action] || log.action}</span>
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
                            <div className="log-detail-label">命令</div>
                            <code className="log-detail-code">{command}</code>
                          </div>
                        )}
                        {outputText && (
                          <div className="log-detail-section">
                            <div className="log-detail-label">输出</div>
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
