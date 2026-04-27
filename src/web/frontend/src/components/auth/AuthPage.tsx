import { useEffect, useState } from 'react';
import { getTools, executeAction, type Tool } from '../../api/tools';
import { useApp } from '../Layout/AppContext';

export default function AuthPage() {
  const { showToast, setConnectionStatus } = useApp();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningTool, setActioningTool] = useState<string | null>(null);
  const [output, setOutput] = useState('');

  useEffect(() => { loadAuth(); }, []);

  async function loadAuth() {
    setLoading(true);
    try {
      const data = await getTools();
      const authTools = (data.tools || []).filter((t: any) => t.hasAuth || t.authStatus === 'unauthorized' || t.authStatus === 'partial');
      setTools(authTools);
      setConnectionStatus('connected');
    } catch { setConnectionStatus('error'); } finally { setLoading(false); }
  }

  async function handleAction(name: string, action: string) {
    setActioningTool(name);
    setOutput('');
    try {
      for await (const event of executeAction(name, action)) {
        if (event.type === 'output') setOutput(prev => prev + event.message + '\n');
        if (event.type === 'success') { showToast(event.message || '操作成功'); loadAuth(); break; }
        if (event.type === 'error') { showToast(event.message || '操作失败', 'error'); break; }
      }
    } catch { showToast('操作失败', 'error'); } finally { setActioningTool(null); }
  }

  const authorized = tools.filter((t: any) => t.authStatus === 'authorized');
  const unauthorized = tools.filter((t: any) => t.authStatus !== 'authorized');

  if (loading) return <div className="loading"><div className="loading-dots"><span></span><span></span><span></span></div>加载中...</div>;

  return (
    <div>
      <div className="auth-summary">
        <div className="summary-card">
          <span className="summary-num">{authorized.length}</span>
          <span className="summary-label">已授权</span>
        </div>
        <div className="summary-card">
          <span className="summary-num">{unauthorized.length}</span>
          <span className="summary-label">待授权</span>
        </div>
        <div className="summary-card">
          <span className="summary-num">{tools.length}</span>
          <span className="summary-label">需要授权</span>
        </div>
      </div>
      <div className="auth-list">
        {tools.length === 0 && <div className="loading" style={{ padding: 40 }}>所有工具均已授权或无需授权</div>}
        {tools.map(tool => {
          const isAuth = (tool as any).authStatus === 'authorized';
          return (
            <div key={tool.id || tool.name} className="tool-card">
              <div className="tool-card-body">
                <div className="tool-card-row">
                  <span className="tool-name">{tool.name}</span>
                  <span className={`tool-auth ${isAuth ? 'ok' : 'fail'}`}>
                    {isAuth ? '已授权' : '未授权'}
                  </span>
                </div>
                <div className="tool-desc">{tool.description}</div>
                {(tool as any).authMessage && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>{(tool as any).authMessage}</div>}
                <div className="tool-card-actions">
                  {!isAuth && (
                    <button className="btn-action btn-action--auth" disabled={actioningTool === tool.name} onClick={() => handleAction(tool.name, 'auth')}>
                      {actioningTool === tool.name ? '授权中...' : '授权'}
                    </button>
                  )}
                  <button className="btn-action" disabled={actioningTool === tool.name} onClick={() => handleAction(tool.name, 'auth')}>
                    重新授权
                  </button>
                </div>
                {actioningTool === tool.name && output && (
                  <pre className="progress-output" style={{ marginTop: 8, maxHeight: 120, overflow: 'auto', fontSize: 11 }}>{output}</pre>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
