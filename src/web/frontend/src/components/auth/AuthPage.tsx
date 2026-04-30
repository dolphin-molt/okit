import { useEffect, useState } from 'react';
import { getTools, executeAction, type Tool } from '../../api/tools';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import VaultPickerModal from '../shared/VaultPickerModal';

export default function AuthPage() {
  const { showToast, setConnectionStatus } = useApp();
  const { t } = useI18n();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningTool, setActioningTool] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [authTool, setAuthTool] = useState<Tool | null>(null);

  useEffect(() => { loadAuth(); }, []);

  async function loadAuth() {
    setLoading(true);
    try {
      const data = await getTools(true);
      const authTools = (data.tools || []).filter((t: any) => t.hasAuth || t.authStatus === 'unauthorized' || t.authStatus === 'partial');
      setTools(authTools);
      setConnectionStatus('connected');
    } catch { setConnectionStatus('error'); } finally { setLoading(false); }
  }

  async function runAction(name: string, action: string, options?: Record<string, any>) {
    setActioningTool(name);
    setOutput('');
    try {
      for await (const event of executeAction(name, action, options)) {
        if (event.type === 'output') setOutput(prev => prev + (event.message || event.text || '') + '\n');
        if (event.type === 'result') {
          showToast(event.success ? t('common.success') : (event.output || t('common.failed')), event.success ? 'success' : 'error');
          if (event.success) loadAuth();
          break;
        }
        if (event.type === 'success') { showToast(event.message || t('common.success')); loadAuth(); break; }
        if (event.type === 'error') { showToast(event.message || t('common.failed'), 'error'); break; }
      }
    } catch { showToast(t('common.failed'), 'error'); } finally { setActioningTool(null); }
  }

  function handleAction(tool: Tool, action: string) {
    if (action === 'auth' && tool.authMethods && tool.authMethods.length > 1) {
      setAuthTool(tool);
      return;
    }
    runAction(tool.name, action);
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
                    <button className="btn-action btn-action--auth" disabled={actioningTool === tool.name} onClick={() => handleAction(tool, 'auth')}>
                      {actioningTool === tool.name ? t('common.authorizing') : t('common.authorize')}
                    </button>
                  )}
                  <button className="btn-action btn-action--reauth" disabled={actioningTool === tool.name} onClick={() => handleAction(tool, 'auth')}>
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
      {authTool && (
        <AuthMethodModal
          tool={authTool}
          onClose={() => setAuthTool(null)}
          onRun={(options) => {
            setAuthTool(null);
            runAction(authTool.name, 'auth', options);
          }}
        />
      )}
    </div>
  );
}

function AuthMethodModal({ tool, onClose, onRun }: {
  tool: Tool;
  onClose: () => void;
  onRun: (options: Record<string, any>) => void;
}) {
  const [methodIndex, setMethodIndex] = useState(() => Math.max(0, tool.authMethods?.findIndex(m => m.recommended) ?? 0));
  const [vaultKey, setVaultKey] = useState('');
  const [showVaultPicker, setShowVaultPicker] = useState(false);

  const methods = tool.authMethods || [];
  const method = methods[methodIndex];
  const needsToken = Boolean(method?.command?.includes('{token}'));

  function submit() {
    if (!method) return;
    if (needsToken && !vaultKey) return;
    onRun({ authMethod: methodIndex, ...(needsToken ? { vaultKey } : {}) });
  }

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel auth-method-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-panel-header auth-method-header">
          <div>
            <span className="auth-method-kicker">授权</span>
            <h2>{tool.name} 授权方式</h2>
          </div>
          <button className="auth-method-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal-panel-body auth-method-body">
          <div className="auth-method-section">
            <div className="auth-method-label">授权方式</div>
            <div className="auth-method-options">
              {methods.map((m, idx) => (
                <button
                  key={`${m.name}-${idx}`}
                  type="button"
                  className={`auth-method-option${methodIndex === idx ? ' active' : ''}`}
                  onClick={() => { setMethodIndex(idx); setVaultKey(''); }}
                >
                  <span className="auth-method-option-title">
                    {m.name}
                    {m.recommended && <span className="auth-method-recommended">推荐</span>}
                  </span>
                  {m.description && <span className="auth-method-option-desc">{m.description}</span>}
                </button>
              ))}
            </div>
          </div>
          {method?.tokenUrl && (
            <a className="auth-token-link" href={method.tokenUrl} target="_blank" rel="noreferrer">{method.tokenHint || '打开 Token 页面'}</a>
          )}
          {needsToken && (
            <div className="auth-method-section auth-vault-reference settings-workspace settings-workspace--light">
              <div className="settings-field--secret">
                <div className="auth-method-label">选择 Access Token</div>
                <div className="vault-ref-field auth-vault-ref-field">
                  {vaultKey ? (
                    <div className="vault-ref-selected">
                      <span className="vault-ref-key">{vaultKey}</span>
                      <button type="button" className="vault-ref-clear" onClick={() => setVaultKey('')}>×</button>
                      <button type="button" className="vault-ref-change" onClick={() => setShowVaultPicker(true)}>更换</button>
                    </div>
                  ) : (
                    <button type="button" className="vault-ref-trigger" onClick={() => setShowVaultPicker(true)}>从密钥管理选择</button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-panel-footer auth-method-footer">
          <button className="auth-method-secondary" onClick={onClose}>取消</button>
          <button className="auth-method-primary" onClick={submit} disabled={needsToken && !vaultKey}>开始授权</button>
        </div>
      </div>
    </div>
    {showVaultPicker && (
      <div className="settings-workspace settings-workspace--light">
      <VaultPickerModal
        selected={vaultKey}
        onSelect={key => { setVaultKey(key); setShowVaultPicker(false); }}
        onClose={() => setShowVaultPicker(false)}
      />
      </div>
    )}
    </>
  );
}
