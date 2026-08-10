import { useEffect, useState, useCallback } from 'react';
import { getUsage, getSupportedUsageProviders, listProviders, UsageResult, UsageWindow, Provider } from '../../api/providers';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

// Display metadata for known supported providers (icon + human-readable name).
const PROVIDER_META: Record<string, { name: string; type: string }> = {
  'openai-codex': { name: 'Codex (ChatGPT)', type: 'OAuth 订阅' },
  'anthropic': { name: 'Claude Code', type: 'OAuth 订阅' },
  'glm-coding': { name: 'GLM Coding Plan', type: '订阅制' },
  'kimi-coding-plan': { name: 'Kimi Coding Plan', type: '订阅制' },
  'minimax-coding': { name: 'MiniMax Token Plan', type: '订阅制' },
  'openrouter': { name: 'OpenRouter', type: '充值制' },
  'volcengine-coding': { name: '火山引擎 Coding Plan', type: '订阅制 (AK/SK)' },
};

export default function UsagePage() {
  const { showToast: toast } = useApp() as any;
  const { t } = useI18n();
  _t = t; // expose t to UsageBar which renders outside the hook scope
  const [supportedIds, setSupportedIds] = useState<string[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [usageMap, setUsageMap] = useState<Record<string, UsageResult>>({});
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<number>(0);

  // Load supported provider IDs and the full provider list (for display names).
  useEffect(() => {
    Promise.all([getSupportedUsageProviders(), listProviders()])
      .then(([sup, provData]) => {
        setSupportedIds(sup.providers || []);
        setProviders(provData.providers || []);
      })
      .catch(() => {});
  }, []);

  const fetchOne = useCallback(async (id: string) => {
    setFetchingIds(prev => new Set(prev).add(id));
    try {
      const res = await getUsage(id);
      setUsageMap(prev => ({ ...prev, [id]: res }));
    } catch (err: any) {
      setUsageMap(prev => ({ ...prev, [id]: { supported: true, error: err.message } }));
    } finally {
      setFetchingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, []);

  const fetchAll = useCallback(async () => {
    for (const id of supportedIds) {
      fetchOne(id); // fire all in parallel (don't await)
    }
    setLastRefresh(Date.now());
  }, [supportedIds, fetchOne]);

  // Auto-fetch on first load once we know which providers are supported.
  useEffect(() => {
    if (supportedIds.length > 0 && Object.keys(usageMap).length === 0) {
      fetchAll();
    }
  }, [supportedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  function providerName(id: string): string {
    const meta = PROVIDER_META[id];
    if (meta) return meta.name;
    const p = providers.find(x => x.id === id);
    return p?.name || id;
  }

  function providerType(id: string): string {
    return PROVIDER_META[id]?.type || '';
  }

  const allCards = supportedIds.map(id => ({
    id,
    name: providerName(id),
    type: providerType(id),
    usage: usageMap[id],
    fetching: fetchingIds.has(id),
  }));

  // Sort: cards with usage data first, then fetching, then empty.
  allCards.sort((a, b) => {
    const score = (c: typeof a) => c.usage?.windows?.length ? 0 : c.fetching ? 1 : 2;
    return score(a) - score(b);
  });

  const queriedCount = Object.keys(usageMap).length;
  const okCount = allCards.filter(c => (c.usage?.windows?.length || 0) > 0).length;
  const errCount = allCards.filter(c => c.usage?.error).length;

  return (
    <div className="access-workspace usage-workspace">
      <header className="access-hero">
        <div className="usage-hero-bar">
          <div className="usage-hero-stats">
            <div className="stat-chip">
              <span className="stat-chip-value">{supportedIds.length}</span>
              <span className="stat-chip-label">{t('usage.supported')}</span>
            </div>
            <div className={`stat-chip${okCount > 0 ? ' stat-chip--success' : ''}`}>
              <span className="stat-chip-value">{okCount}</span>
              <span className="stat-chip-label">{t('usage.normal')}</span>
            </div>
            {errCount > 0 && (
              <div className="stat-chip stat-chip--warn">
                <span className="stat-chip-value">{errCount}</span>
                <span className="stat-chip-label">{t('usage.errors')}</span>
              </div>
            )}
            {lastRefresh > 0 && (
              <div className="stat-chip stat-chip--muted">
                <span className="stat-chip-value">{formatTimeAgo(lastRefresh)}</span>
                <span className="stat-chip-label">{t('usage.lastRefresh')}</span>
              </div>
            )}
          </div>
          <button className="usage-refresh-btn" onClick={fetchAll} disabled={fetchingIds.size > 0}>
            {fetchingIds.size > 0 ? (
              <><span className="provider-status-spinner" aria-hidden="true" /> {t('usage.refreshing')}</>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 9a5.5 5.5 0 1 1-1.6-3.9" />
                  <path d="M14.5 3.5v4h-4" />
                </svg>
                {t('usage.refreshAll')}
              </>
            )}
          </button>
        </div>
      </header>

      <div className="usage-grid">
        {allCards.map(card => (
          <UsageCard
            key={card.id}
            id={card.id}
            name={card.name}
            type={card.type}
            usage={card.usage}
            fetching={card.fetching}
            onRefresh={() => fetchOne(card.id)}
            t={t}
          />
        ))}
      </div>

      {supportedIds.length === 0 && (
        <div className="empty-state"><p>{t('usage.noProviders')}</p></div>
      )}
    </div>
  );
}

function UsageCard({ id, name, type, usage, fetching, onRefresh, t }: {
  id: string;
  name: string;
  type: string;
  usage?: UsageResult;
  fetching: boolean;
  onRefresh: () => void;
  t: (k: string, ...args: any[]) => string;
}) {
  const hasData = usage?.supported && (usage.windows?.length || 0) > 0;
  const hasError = usage?.error;

  // Compute overall status for card border color.
  const maxPct = usage?.windows?.reduce((max, w) => {
    if (w.usedPercent == null) return max;
    return Math.max(max, w.usedPercent);
  }, 0) || 0;
  const statusClass = !hasData ? '' : maxPct >= 90 ? ' usage-card--danger' : maxPct >= 70 ? ' usage-card--warn' : ' usage-card--ok';

  return (
    <div className={`usage-card${statusClass}`}>
      <div className="usage-card-header">
        <div className="usage-card-title">
          <h3>{name}</h3>
          {type && <span className="usage-card-type">{type}</span>}
        </div>
        <button className="btn-icon usage-card-refresh" onClick={onRefresh} disabled={fetching} title={t('usage.refresh')}>
          {fetching ? (
            <span className="provider-status-spinner" aria-hidden="true" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.6-6.4" />
              <path d="M21 3v6h-6" />
            </svg>
          )}
        </button>
      </div>

      <div className="usage-card-body">
        {fetching && !usage && (
          <div className="usage-card-loading">{t('usage.loading')}</div>
        )}
        {hasError && !fetching && (
          <div className="usage-card-error">{usage!.error}</div>
        )}
        {hasData && !fetching && (
          <div className="usage-card-windows">
            {usage!.windows!.map((w, i) => (
              <UsageBar key={i} w={w} />
            ))}
          </div>
        )}
        {!hasData && !hasError && !fetching && (
          <div className="usage-card-empty">{t('usage.empty')}</div>
        )}
      </div>
    </div>
  );
}

function UsageBar({ w }: { w: UsageWindow }) {
  const pct = w.usedPercent;                                  // 已用百分比
  const remaining = pct != null ? round1(100 - pct) : null;   // 剩余百分比
  const tone = pct == null ? 'unknown' : pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
  const resetText = w.resetAt ? formatResetTime(w.resetAt) : null;

  if (w.isPrepaid && w.usedCredits != null) {
    const rem = w.remainingCredits != null ? `$${w.remainingCredits.toFixed(2)}` : '?';
    const used = `$${w.usedCredits.toFixed(2)}`;
    return (
      <div className={`usage-bar usage-bar--${tone}`}>
        <span className="usage-bar-label">{w.label}</span>
        <div className="usage-bar-info">
          <span className="usage-bar-credits">{t_global('usage.used')}: {used}</span>
          <span className="usage-bar-remaining">{t_global('usage.remaining')}: {rem}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`usage-bar usage-bar--${tone}`}>
      <span className="usage-bar-label">{w.label}</span>
      <div className="usage-bar-track">
        <div className="usage-bar-fill" style={{ width: remaining != null ? `${Math.min(remaining, 100)}%` : '100%' }} />
      </div>
      <span className="usage-bar-pct">{remaining != null ? `${remaining}%` : '?'}</span>
      {resetText && <span className="usage-bar-reset" title={w.resetAt || ''}>{resetText}</span>}
    </div>
  );
}

// ── Helpers ──

function round1(n: number): number { return Math.round(n * 10) / 10; }

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  return `${Math.floor(diff / 3600000)}h`;
}

function formatResetTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    if (diffMs <= 0) return '';
    // 展示重置时间点,如 "18:26" / "明天 08:00" / "8/16 08:00"
    const sameDay = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const hhmm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (sameDay) return hhmm;
    if (isTomorrow) return `明天 ${hhmm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
  } catch {
    return '';
  }
}

// Module-level i18n accessor (set by the page component on each render).
let _t: (k: string, ...args: any[]) => string = (k: string) => k;
function t_global(k: string, ...args: any[]): string { return _t(k, ...args); }
// Wire _t from the hook — called once at module eval in UsagePage via the
// `_t = t` assignment pattern below.
