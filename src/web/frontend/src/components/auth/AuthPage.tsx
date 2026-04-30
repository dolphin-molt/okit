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
    <div className="access-workspace auth-workspace">
      <header className="access-hero">
        <div className="access-hero-copy">
          <h1>{t('auth.title')}</h1>
          <p>{t('auth.lede')}</p>
        </div>
        <div className="access-hero-stats" aria-label="Authorization summary">
          <div><span>{t('common.authorized')}</span><strong>{authorized.length}</strong></div>
          <div><span>{t('auth.needsAuth')}</span><strong>{unauthorized.length}</strong></div>
          <div><span>{t('auth.managedTools')}</span><strong>{tools.length}</strong></div>
          <div><span>{t('auth.actioning')}</span><strong>{actioningTool ? 1 : 0}</strong></div>
        </div>
      </header>

      <div className="auth-list">
        {tools.length === 0 && (
          <div className="vault-empty-state">
            <strong>{t('auth.allAuthorized')}</strong>
            <span>{t('auth.emptyDesc')}</span>
          </div>
        )}
        {tools.map(tool => {
          const isAuth = (tool as any).authStatus === 'authorized';
          return (
            <article key={tool.id || tool.name} className={`auth-card${isAuth ? ' auth-card--ok' : ' auth-card--fail'}`}>
              <div className="auth-card-body">
                <div className="auth-card-main">
                  <span className={`auth-status-icon ${isAuth ? 'auth-ok' : 'auth-fail'}`}>{isAuth ? '✓' : '!'}</span>
                  <div className="auth-card-info">
                    <span className="auth-card-name">{tool.name}</span>
                    <span className="auth-card-cat">{tool.category || tool.id || 'tool'}</span>
                  </div>
                  <span className={`auth-badge ${isAuth ? 'auth-badge--ok' : 'auth-badge--fail'}`}>
                    {isAuth ? t('common.authorized') : t('common.unauthorized')}
                  </span>
                </div>
                <div className="auth-card-detail">{tool.description}</div>
                {(tool as any).authMessage && <div className="auth-card-message">{(tool as any).authMessage}</div>}
                <div className="auth-card-actions">
                  {!isAuth && (
                    <button className="btn-action btn-action--auth" disabled={actioningTool === tool.name} onClick={() => handleAction(tool.name, 'auth')}>
                      {actioningTool === tool.name ? t('common.authorizing') : t('common.authorize')}
                    </button>
                  )}
                  <button className="btn-action btn-action--reauth" disabled={actioningTool === tool.name} onClick={() => handleAction(tool.name, 'auth')}>
                    {t('common.reAuth')}
                  </button>
                </div>
                {actioningTool === tool.name && output && (
                  <pre className="progress-output auth-progress-output">{output}</pre>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
