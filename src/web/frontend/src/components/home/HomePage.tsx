import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTools, Tool } from '../../api/tools';
import { listVault, VaultSecret } from '../../api/vault';
import { getAdapters, listProviders, AgentInfo, Provider } from '../../api/providers';
import { getLogs, LogEntry } from '../../api/logs';
import { getSyncStatus } from '../../api/sync';
import { useI18n } from '../../i18n';

interface HomeState {
  tools: Tool[];
  toolSummary: Record<string, number>;
  secrets: VaultSecret[];
  providers: Provider[];
  adapters: AgentInfo[];
  logs: LogEntry[];
  sync: { machineId: string | null; lastSyncAt: string | null; platformId: string | null; hasPassword: boolean } | null;
  loading: boolean;
}

const emptyState: HomeState = {
  tools: [],
  toolSummary: {},
  secrets: [],
  providers: [],
  adapters: [],
  logs: [],
  sync: null,
  loading: true,
};

function formatTime(value?: string | number, lang: 'zh' | 'en' = 'zh') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusPill({ tone, children }: { tone: 'good' | 'warn' | 'idle'; children: React.ReactNode }) {
  return <span className={`home-pill home-pill--${tone}`}>{children}</span>;
}

export default function HomePage() {
  const { t, lang } = useI18n();
  const [state, setState] = useState<HomeState>(emptyState);

  async function loadData(refresh = false) {
    setState(prev => ({ ...prev, loading: true }));
    const [toolsResult, vaultResult, providersResult, adaptersResult, logsResult, syncResult] = await Promise.allSettled([
      getTools(refresh),
      listVault(),
      listProviders(),
      getAdapters(),
      getLogs(),
      getSyncStatus(),
    ]);

    const toolsPayload = toolsResult.status === 'fulfilled' ? toolsResult.value : { tools: [], summary: {} };

    setState({
      tools: toolsPayload.tools,
      toolSummary: toolsPayload.summary,
      secrets: vaultResult.status === 'fulfilled' ? vaultResult.value.secrets : [],
      providers: providersResult.status === 'fulfilled' ? providersResult.value.providers : [],
      adapters: adaptersResult.status === 'fulfilled' ? adaptersResult.value.adapters : [],
      logs: logsResult.status === 'fulfilled' ? logsResult.value.slice(0, 5) : [],
      sync: syncResult.status === 'fulfilled' ? syncResult.value : null,
      loading: false,
    });
  }

  useEffect(() => {
    loadData();
  }, []);

  const computed = useMemo(() => {
    const installed = state.toolSummary.installed ?? state.tools.filter(tool => tool.status === 'installed').length;
    const authIssues = state.tools.filter(tool => tool.authRequired && tool.authStatus !== 'authorized').length;
    const configuredAgents = state.adapters.filter(adapter => adapter.current).length;

    return {
      installed,
      authIssues,
      configuredAgents,
      totalAliases: state.secrets.reduce((sum, secret) => sum + secret.aliases.length, 0),
      lastLog: state.logs[0],
    };
  }, [state]);

  return (
    <div className="home-page">
      <header className="home-hero">
        <div>
          <p className="home-kicker">$ okit access status</p>
          <h1>{t('home.title')}</h1>
          <p className="home-lede">{t('home.lede')}</p>
        </div>
      </header>

      <section className="home-stat-grid" aria-label="Runtime overview">
        <article className="home-stat-card">
          <span>{t('home.toolHealth')}</span>
          <strong>{computed.installed}<small>/{state.tools.length || 0}</small></strong>
          <p>{computed.authIssues > 0 ? t('home.toolHealth.issues', { n: computed.authIssues }) : t('home.toolHealth.ok')}</p>
        </article>
        <article className="home-stat-card">
          <span>{t('home.vault')}</span>
          <strong>{state.secrets.length}<small> {t('home.keys')}</small></strong>
          <p>{t('home.vault.desc', { n: computed.totalAliases })}</p>
        </article>
        <article className="home-stat-card">
          <span>{t('home.modelAccess')}</span>
          <strong>{state.providers.length}<small> {t('home.providers')}</small></strong>
          <p>{t('home.modelAccess.desc', { n: computed.configuredAgents })}</p>
        </article>
        <article className="home-stat-card">
          <span>{t('home.cloudSync')}</span>
          <strong>{state.sync?.platformId || 'off'}</strong>
          <p>{state.sync?.lastSyncAt ? t('home.cloudSync.last', { time: formatTime(state.sync.lastSyncAt, lang) }) : t('home.cloudSync.desc')}</p>
        </article>
      </section>

      <section className="home-grid">
        <article className="home-panel home-panel--runtime">
          <div className="home-panel-head">
            <div>
              <span>{t('home.accessChecklist')}</span>
              <h2>{t('home.accessState')}</h2>
            </div>
            <button className="btn-refresh" onClick={() => loadData(true)} title={t('common.refresh')}>↻</button>
          </div>
          <div className="home-check-list">
            <div>
              <StatusPill tone={state.tools.length ? 'good' : 'idle'}>{state.tools.length ? t('home.ready') : t('home.empty')}</StatusPill>
              <span>{t('home.check.tools')}</span>
              <b>{state.tools.length || 0}</b>
            </div>
            <div>
              <StatusPill tone={state.secrets.length ? 'good' : 'warn'}>{state.secrets.length ? t('home.sealed') : t('home.missing')}</StatusPill>
              <span>{t('home.check.vault')}</span>
              <b>{state.secrets.length}</b>
            </div>
            <div>
              <StatusPill tone={state.providers.length ? 'good' : 'idle'}>{state.providers.length ? t('home.routed') : t('home.empty')}</StatusPill>
              <span>{t('home.check.models')}</span>
              <b>{state.providers.length}</b>
            </div>
            <div>
              <StatusPill tone={state.sync?.platformId ? 'good' : 'idle'}>{state.sync?.platformId ? t('home.online') : t('home.local')}</StatusPill>
              <span>{t('home.check.sync')}</span>
              <b>{state.sync?.platformId || '-'}</b>
            </div>
          </div>
        </article>

        <article className="home-panel">
          <div className="home-panel-head">
            <div>
              <span>{t('home.quickActions')}</span>
              <h2>{t('home.quickActions.title')}</h2>
            </div>
          </div>
          <div className="home-actions">
            <Link to="/tools">{t('home.action.tools')}</Link>
            <Link to="/vault">{t('home.action.vault')}</Link>
            <Link to="/models">{t('home.action.models')}</Link>
            <Link to="/agent">{t('home.action.agent')}</Link>
          </div>
        </article>

        <article className="home-panel">
          <div className="home-panel-head">
            <div>
              <span>{t('home.recent')}</span>
              <h2>{t('home.recent.title')}</h2>
            </div>
            <Link to="/logs" className="home-subtle-link">{t('home.viewAll')}</Link>
          </div>
          <div className="home-log-list">
            {state.logs.length === 0 && <div className="home-empty">{t('home.noLogs')}</div>}
            {state.logs.map((log, index) => (
              <div className="home-log-row" key={`${log.timestamp}-${index}`}>
                <i className={log.success ? 'success' : 'failed'} />
                <div>
                  <strong>{log.action || log.name}</strong>
                  <span>{log.name}</span>
                </div>
                <time>{formatTime(log.timestamp, lang)}</time>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
