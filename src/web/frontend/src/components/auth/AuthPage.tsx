import { useEffect, useState } from 'react';
import { getTools, executeAction, type Tool } from '../../api/tools';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

export default function AuthPage() {
  const { showToast, setConnectionStatus } = useApp();
  const { t } = useI18n();
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
        if (event.type === 'success') { showToast(event.message || t('common.success')); loadAuth(); break; }
        if (event.type === 'error') { showToast(event.message || t('common.failed'), 'error'); break; }
      }
    } catch { showToast(t('common.failed'), 'error'); } finally { setActioningTool(null); }
  }

  const authorized = tools.filter((t: any) => t.authStatus === 'authorized');
  const unauthorized = tools.filter((t: any) => t.authStatus !== 'authorized');

  if (loading) return <div className="loading"><div className="loading-dots"><span></span><span></span><span></span></div>{t('common.loading')}</div>;

  return (
    <div>
      <div className="auth-summary">
        <div className="summary-card">
          <span className="summary-num">{authorized.length}</span>
          <span className="summary-label">{t('common.authorized')}</span>
        </div>
        <div className="summary-card">
          <span className="summary-num">{unauthorized.length}</span>
          <span className="summary-label">{t('auth.needsAuth')}</span>
        </div>
        <div className="summary-card">
          <span className="summary-num">{tools.length}</span>
          <span className="summary-label">{t('common.authorize')}</span>
        </div>
      </div>
      <div className="auth-list">
        {tools.length === 0 && <div className="loading" style={{ padding: 40 }}>{t('auth.allAuthorized')}</div>}
        {tools.map(tool => {
          const isAuth = (tool as any).authStatus === 'authorized';
          return (
            <div key={tool.id || tool.name} className="tool-card">
              <div className="tool-card-body">
                <div className="tool-card-row">
                  <span className="tool-name">{tool.name}</span>
                  <span className={`tool-auth ${isAuth ? 'ok' : 'fail'}`}>
                    {isAuth ? t('common.authorized') : t('common.unauthorized')}
                  </span>
                </div>
                <div className="tool-desc">{tool.description}</div>
                {(tool as any).authMessage && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>{(tool as any).authMessage}</div>}
                <div className="tool-card-actions">
                  {!isAuth && (
                    <button className="btn-action btn-action--auth" disabled={actioningTool === tool.name} onClick={() => handleAction(tool.name, 'auth')}>
                      {actioningTool === tool.name ? t('common.authorizing') : t('common.authorize')}
                    </button>
                  )}
                  <button className="btn-action" disabled={actioningTool === tool.name} onClick={() => handleAction(tool.name, 'auth')}>
                    {t('common.reAuth')}
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
