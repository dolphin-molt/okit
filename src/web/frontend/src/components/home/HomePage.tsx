import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getTools } from '../../api/tools';
import { listVault } from '../../api/vault';
import { getAdapters } from '../../api/providers';
import { getSyncStatus, pushSync, pullSync } from '../../api/sync';
import { useI18n } from '../../i18n';
import { useApp } from '../Layout/AppContext';
import VaultFormModal from '../shared/VaultFormModal';

interface QuickState {
  tools: any[];
  toolSummary: Record<string, number>;
  secrets: any[];
  adapters: any[];
  sync: any;
  loading: boolean;
}

const empty: QuickState = { tools: [], toolSummary: {}, secrets: [], adapters: [], sync: null, loading: true };

function formatTime(value?: string | number | null, lang: 'zh' | 'en' = 'zh') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function HomePage() {
  const { t, lang } = useI18n();
  const { showToast } = useApp();
  const navigate = useNavigate();
  const [state, setState] = useState<QuickState>(empty);
  const [showVaultForm, setShowVaultForm] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true }));
    try {
      const [toolsR, vaultR, adaptersR, syncR] = await Promise.allSettled([
        getTools(false, lang),
        listVault(),
        getAdapters(),
        getSyncStatus(),
      ]);
      setState({
        tools: toolsR.status === 'fulfilled' ? toolsR.value.tools : [],
        toolSummary: toolsR.status === 'fulfilled' ? toolsR.value.summary : {},
        secrets: vaultR.status === 'fulfilled' ? (vaultR.value as any).secrets || vaultR.value : [],
        adapters: adaptersR.status === 'fulfilled' ? (adaptersR.value as any).adapters : [],
        sync: syncR.status === 'fulfilled' ? syncR.value : null,
        loading: false,
      });
    } catch (e) {
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [lang]);

  useEffect(() => { loadData(); }, [loadData]);

  const installedCount = state.toolSummary.installed ?? 0;
  const totalCount = state.tools.length;
  const needsAuth = state.tools.filter((tool: any) => tool.status === 'installed' && tool.authRequired && tool.authStatus !== 'authorized').slice(0, 5);
  const recentKeys = state.secrets.slice(0, 3);
  const configuredAgents = state.adapters.filter((a: any) => a.current);

  async function handlePush() {
    setSyncing(true);
    try {
      const res = await pushSync();
      showToast(res.success ? (res.message || t('home.syncDone')) : t('home.syncFail'), res.success ? 'success' : 'error');
      loadData();
    } catch { showToast(t('home.syncFail'), 'error'); }
    setSyncing(false);
  }

  async function handlePull() {
    setSyncing(true);
    try {
      const res = await pullSync();
      showToast(res.success ? (res.message || t('home.syncDone')) : t('home.syncFail'), res.success ? 'success' : 'error');
      loadData();
    } catch { showToast(t('home.syncFail'), 'error'); }
    setSyncing(false);
  }

  function handleVaultSaved(key: string) {
    if (key) { showToast(t('vault.keyAdded')); loadData(); }
    setShowVaultForm(false);
  }

  if (state.loading) return <div className="quick-start-page"><p style={{ padding: 40 }}>{t('common.loading')}</p></div>;

  return (
    <div className="quick-start-page">
      <h2 className="quick-start-title">{t('home.quickStart')}</h2>

      <div className="quick-start-grid">
        {/* ① 工具健康扫描 */}
        <article className="qs-card qs-card--tools">
          <div className="qs-card-head">
            <span className="qs-card-icon">🔧</span>
            <h3>{t('home.scanTools')}</h3>
          </div>
          <div className="qs-stat-row">
            <div className="qs-stat">
              <strong>{installedCount}<small>/{totalCount}</small></strong>
              <span>{t('common.installed')}</span>
            </div>
            {needsAuth.length > 0 && (
              <div className="qs-stat qs-stat--warn">
                <strong>{state.toolSummary.unauthorized ?? needsAuth.length}</strong>
                <span>{t('home.needsAuth')}</span>
              </div>
            )}
          </div>
          {needsAuth.length > 0 && (
            <div className="qs-list">
              {needsAuth.map((tool: any) => (
                <div key={tool.id} className="qs-list-item" onClick={() => navigate('/tools')}>
                  <span>{tool.name}</span>
                  <span className="qs-list-tag">{t('home.needsAuth')}</span>
                </div>
              ))}
            </div>
          )}
          <Link to="/tools" className="qs-link">{t('home.viewAll')} →</Link>
        </article>

        {/* ② 快速添加密钥 */}
        <article className="qs-card qs-card--vault">
          <div className="qs-card-head">
            <span className="qs-card-icon">🔑</span>
            <h3>{t('home.quickAddKey')}</h3>
          </div>
          <button className="qs-btn qs-btn--primary" onClick={() => setShowVaultForm(true)}>
            + {t('home.addApiKey')}
          </button>
          {recentKeys.length > 0 && (
            <div className="qs-list">
              {recentKeys.map((s: any) => (
                <div key={s.key} className="qs-list-item">
                  <span>{s.key}</span>
                  {s.group && <span className="qs-list-tag">{s.group}</span>}
                </div>
              ))}
            </div>
          )}
          <Link to="/vault" className="qs-link">{t('home.manageKeys')} →</Link>
        </article>

        {/* ③ 云同步 */}
        <article className="qs-card qs-card--sync">
          <div className="qs-card-head">
            <span className="qs-card-icon">☁</span>
            <h3>{t('home.cloudSync')}</h3>
          </div>
          <div className="qs-sync-status">
            <div className="qs-stat">
              <strong>{state.sync?.platformId || 'off'}</strong>
              <span>{t('home.syncPlatform')}</span>
            </div>
            <div className="qs-sync-time">
              {state.sync?.lastSyncAt
                ? t('home.syncLast', { time: formatTime(state.sync.lastSyncAt, lang) })
                : t('home.syncNever')}
            </div>
          </div>
          <div className="qs-btn-row">
            <button className="qs-btn" onClick={handlePush} disabled={syncing || !state.sync?.platformId}>
              {syncing ? '...' : t('home.syncPush')}
            </button>
            <button className="qs-btn" onClick={handlePull} disabled={syncing || !state.sync?.platformId}>
              {syncing ? '...' : t('home.syncPull')}
            </button>
          </div>
          <Link to="/settings" className="qs-link">{t('home.syncSettings')} →</Link>
        </article>
      </div>

      {/* ④ 快速配置 Agent */}
      <article className="qs-card qs-card--agents">
        <div className="qs-card-head">
          <span className="qs-card-icon">🤖</span>
          <h3>{t('home.quickConfigAgent')}</h3>
          <span className="qs-agent-summary">
            {t('home.agentConfigured', { n: configuredAgents.length, total: state.adapters.length })}
          </span>
        </div>
        <div className="qs-agent-grid">
          {state.adapters.map((agent: any) => (
            <div key={agent.id} className={`qs-agent-item${!agent.current ? ' qs-agent-item--warn' : ''}`}>
              <div className="qs-agent-info">
                <span className="qs-agent-name">{agent.name}</span>
                <span className="qs-agent-model">
                  {agent.current
                    ? `${agent.current.modelId} @ ${agent.current.providerName}`
                    : t('home.notConfigured')}
                </span>
              </div>
              <Link to="/agents" className={`qs-btn qs-btn--sm${!agent.current ? ' qs-btn--primary' : ''}`}>
                {agent.current ? t('home.reconfig') : t('home.selectModel')}
              </Link>
            </div>
          ))}
        </div>
      </article>

      {showVaultForm && (
        <VaultFormModal
          groups={[]}
          onClose={() => setShowVaultForm(false)}
          onSaved={handleVaultSaved}
        />
      )}
    </div>
  );
}
