// Goal ②: a compact "today's usage" strip for the home dashboard.
//
// Surfaces remaining quota for all supported providers. Each card shows the REMAINING
// amount per window — not the used percentage — because "how much do I have
// left" is the daily-driver question. Subscription providers show every window
// they report (e.g. GLM shows both 5h and monthly; Codex shows 5h + weekly);
// prepaid providers show the dollar balance.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { getUsage, getSupportedUsageProviders, listProviders, UsageResult, UsageWindow } from '../../api/providers';
import { useI18n } from '../../i18n';
import { useUsagePolling } from '../../lib/useUsagePolling';
import { checkAlerts, fireNotifications } from '../../lib/usageAlerts';
import { useNavigate } from 'react-router-dom';
import { getProviderIcon } from '../../assets/providers';

// Map backend window labels (english short codes) to compact UI labels.
const WINDOW_LABEL: Record<string, string> = {
  '5h': '5h',
  'session': '5h',
  'weekly': '周',
  '7d': '7d',
  'monthly': '月',
  'limit': '额度',
  'credits': '余额',
};

// Remaining percent drives the card's border color (red when nearly exhausted).
function toneForRemaining(remainingPct: number | null): string {
  if (remainingPct == null) return 'unknown';
  if (remainingPct <= 10) return 'danger';
  if (remainingPct <= 30) return 'warn';
  return 'ok';
}

function toneLabel(tone: string, t: (k: string) => string): string {
  if (tone === 'danger') return t('home.usageCritical');
  if (tone === 'warn') return t('home.usageWatch');
  return t('home.usageHealthy');
}

function remainingPercent(window: UsageWindow): number | null {
  return window.usedPercent == null ? null : Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)));
}

function RemainingWindows({ u, t }: { u: UsageResult; t: (k: string) => string }) {
  const windows = u.windows || [];
  if (windows.length === 0) {
    return <span className="usage-summary-empty">{u.notice ? t('usage.consoleOnly') : (u.error || '—')}</span>;
  }

  // Prepaid: a single balance row.
  if (u.kind === 'prepaid') {
    const w = windows[0];
    const rem = w.remainingCredits;
    return (
      <div className="usage-summary-balance-wrap">
        <span className="usage-summary-balance">{rem != null ? `$${rem.toFixed(2)}` : '—'}</span>
        <span className="usage-summary-balance-label">{t('home.usageBalance')}</span>
      </div>
    );
  }

  // Subscription: make the most important window visual, then keep the
  // additional reset windows compact below it.
  const primary = windows[0];
  const primaryRemaining = remainingPercent(primary);
  return (
    <div className="usage-summary-windows">
      <div className="usage-summary-primary">
        <div className="usage-summary-primary-head">
          <span>{WINDOW_LABEL[primary.label] || primary.label}</span>
          <strong>{primaryRemaining != null ? `${primaryRemaining}%` : '?'}</strong>
        </div>
        <div className="usage-summary-track" role="progressbar" aria-valuenow={primaryRemaining ?? undefined} aria-valuemin={0} aria-valuemax={100}>
          <span className={`usage-summary-fill usage-summary-fill--${toneForRemaining(primaryRemaining)}`} style={{ width: `${primaryRemaining ?? 0}%` }} />
        </div>
        <span className="usage-summary-primary-caption">{t('home.usageRemaining')}</span>
      </div>
      {windows.slice(1).map((w, i) => {
        const remaining = remainingPercent(w);
        return (
          <div key={i} className="usage-summary-window">
            <span className="usage-summary-window-label">{WINDOW_LABEL[w.label] || w.label}</span>
            <span className="usage-summary-window-mini-track"><span style={{ width: `${remaining ?? 0}%` }} /></span>
            <span className={`usage-summary-window-value usage-summary-window-value--${toneForRemaining(remaining)}`}>
              {remaining != null ? `${remaining}%` : '?'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function UsageSummary() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [supportedIds, setSupportedIds] = useState<string[]>([]);
  const [usageMap, setUsageMap] = useState<Record<string, UsageResult>>({});
  // Provider display names from API (single source of truth = presets.ts).
  const [providerNames, setProviderNames] = useState<Record<string, string>>({});

  useEffect(() => {
    getSupportedUsageProviders()
      .then(sup => setSupportedIds(sup.providers || []))
      .catch(() => {});
    // Load provider names from API (derived from presets.ts — single source).
    listProviders()
      .then(res => {
        const map: Record<string, string> = {};
        for (const p of res.providers || []) map[p.id] = p.name;
        setProviderNames(map);
      })
      .catch(() => {});
  }, []);

  // Silent polling via shared hook (5-min base, 1-min if reset is imminent).
  const handlePollResult = useCallback((id: string, result: UsageResult) => {
    setUsageMap(prev => ({ ...prev, [id]: result }));
  }, []);

  useUsagePolling({
    supportedIds,
    onResult: handlePollResult,
    silent: true,
  });

  // Compute alerts + fire browser notifications.
  const alerts = useMemo(() => checkAlerts(usageMap, providerNames), [usageMap, providerNames]);
  const dangerAlerts = alerts.filter(a => a.severity === 'danger');
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const visibleDangerAlerts = dangerAlerts.filter(a => !dismissedKeys.has(a.notifyKey));

  useEffect(() => {
    if (alerts.length > 0) {
      fireNotifications(alerts);
    }
  }, [alerts]);

  // Build cards: only include providers that actually have usable data
  // (windows present, or a meaningful balance). Skip providers whose only
  // signal is an error/empty — they would clutter the strip with "—" cards.
  const cards = supportedIds
    .filter(id => {
      const u = usageMap[id];
      if (!u || u.supported === false) return false;
      const hasWindows = (u.windows?.length || 0) > 0;
      return hasWindows;
    })
    .map(id => {
      const u = usageMap[id];
      // Card border color = the worst (lowest remaining) window's tone.
      let cardTone = 'unknown';
      if (u?.kind === 'prepaid') {
        cardTone = 'ok';
      } else {
        for (const w of u?.windows || []) {
          const remaining = w.usedPercent != null ? 100 - w.usedPercent : null;
          const wt = toneForRemaining(remaining);
          // danger > warn > ok > unknown
          if (wt === 'danger') cardTone = 'danger';
          else if (wt === 'warn' && cardTone !== 'danger') cardTone = 'warn';
          else if (wt === 'ok' && cardTone !== 'danger' && cardTone !== 'warn') cardTone = 'ok';
        }
      }
      return { id, name: providerNames[id] || id, usage: u, tone: cardTone };
    });

  if (cards.length === 0) return null;

  return (
    <section className="home-section usage-summary-section">
      <div className="usage-summary-heading">
        <div>
          <div className="home-section-title">{t('home.usageSummary')}</div>
          <p>{t('home.usageSummaryHint')}</p>
        </div>
        <button className="usage-summary-link" onClick={() => navigate('/usage')}>
          {t('usage.viewAll')} <span aria-hidden="true">↗</span>
        </button>
      </div>
      {visibleDangerAlerts.length > 0 && (
        <div className="usage-alerts">
          {visibleDangerAlerts.slice(0, 3).map(a => (
            <div key={a.notifyKey} className="usage-alert usage-alert--danger">
              <span className="usage-alert-icon">🔴</span>
              <span className="usage-alert-text">{a.message}</span>
              <button
                className="usage-alert-close"
                onClick={() => setDismissedKeys(prev => new Set(prev).add(a.notifyKey))}
              >✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="usage-summary-grid">
        {cards.map(c => (
          <article key={c.id} className={`usage-summary-card usage-summary-card--${c.tone}${c.usage?.kind === 'prepaid' ? ' usage-summary-card--prepaid' : ''}`}>
            <div className="usage-summary-card-head">
              <div className="usage-summary-provider">
                {getProviderIcon(c.id) && <img src={getProviderIcon(c.id)} alt="" />}
                <span>{c.name}</span>
              </div>
              <span className={`usage-summary-status usage-summary-status--${c.tone}`}>
                {c.usage?.kind === 'prepaid' ? t('home.usageBalance') : toneLabel(c.tone, t)}
              </span>
            </div>
            <RemainingWindows u={c.usage!} t={t} />
          </article>
        ))}
      </div>
    </section>
  );
}
