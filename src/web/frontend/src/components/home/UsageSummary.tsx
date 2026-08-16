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

function compactAlertMessage(message: string, providerName: string): string {
  const prefix = `${providerName} `;
  const compact = message.startsWith(prefix) ? message.slice(prefix.length) : message;
  return compact
    .replace('将在 ', '')
    .replace('后重置，还有 ', '后重置 · ')
    .replace(' 未使用', ' 未用');
}

type UsageCard = {
  id: string;
  name: string;
  usage: UsageResult;
  tone: string;
};

function compactPrimaryValue(u: UsageResult, t: (k: string) => string): { value: string; detail: string } {
  const windows = u.windows || [];
  const first = windows[0];

  if (u.kind === 'prepaid') {
    const value = first?.remainingCredits != null
      ? (first.unit ? `${first.remainingCredits.toFixed(2)} ${first.unit}` : `$${first.remainingCredits.toFixed(2)}`)
      : '—';
    return { value, detail: t('home.usageBalance') };
  }

  if (first?.unit) {
    return {
      value: first.remainingCredits != null ? `${first.remainingCredits.toFixed(2)} ${first.unit}` : '—',
      detail: t('home.usageRemaining'),
    };
  }

  const remaining = first ? remainingPercent(first) : null;
  const detail = windows.slice(0, 2).map(w => {
    const pct = remainingPercent(w);
    return `${WINDOW_LABEL[w.label] || w.label} ${pct != null ? `${pct}%` : '?'}`;
  }).join(' · ');
  return { value: remaining != null ? `${remaining}%` : '—', detail };
}

function UsageCompactCard({ card, alert, t }: { card: UsageCard; alert?: ReturnType<typeof checkAlerts>[number]; t: (k: string) => string }) {
  const tone = alert?.severity || card.tone;
  const { value, detail } = compactPrimaryValue(card.usage, t);
  return (
    <article className={`usage-summary-compact-card usage-summary-compact-card--${tone}`}>
      <div className="usage-summary-compact-head">
        <div className="usage-summary-provider">
          {getProviderIcon(card.id) && <img src={getProviderIcon(card.id)} alt="" />}
          <span>{card.name}</span>
        </div>
        <span className={`usage-summary-status usage-summary-status--${tone}`}>
          {alert ? toneLabel(alert.severity, t) : card.usage.kind === 'prepaid' ? t('home.usageBalance') : toneLabel(card.tone, t)}
        </span>
      </div>
      <div className="usage-summary-compact-value">
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
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
        <span className="usage-summary-balance">
          {rem != null ? (w.unit ? `${rem.toFixed(2)} ${w.unit}` : `$${rem.toFixed(2)}`) : '—'}
        </span>
        <span className="usage-summary-balance-label">{t('home.usageBalance')}</span>
      </div>
    );
  }

  // Token Plan credits are quota, not currency. Keep them out of the dollar
  // balance treatment while still surfacing the remaining amount on Home.
  if (windows[0]?.unit) {
    const w = windows[0];
    return (
      <span className="usage-summary-balance">
        {w.remainingCredits != null ? `${w.remainingCredits.toFixed(2)} ${w.unit}` : '—'}
      </span>
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
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [alertCenterOpen, setAlertCenterOpen] = useState(false);
  const visibleAlerts = alerts.filter(a => !dismissedKeys.has(a.notifyKey));
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (alerts.length > 0) {
      fireNotifications(alerts);
    }
  }, [alerts]);

  // Build cards: only include providers that actually have usable data
  // (windows present, or a meaningful balance). Skip providers whose only
  // signal is an error/empty — they would clutter the strip with "—" cards.
  const cards: UsageCard[] = supportedIds
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
        const w = u.windows?.[0];
        const rem = w?.remainingCredits != null
          ? w.remainingCredits
          : w?.limitCredits != null && w.usedCredits != null
            ? w.limitCredits - w.usedCredits
            : null;
        const remainingPct = rem != null && w?.limitCredits != null && w.limitCredits > 0
          ? Math.min(100, Math.max(0, (rem / w.limitCredits) * 100))
          : rem != null && rem <= 0 ? 0 : null;
        cardTone = toneForRemaining(remainingPct);
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

  // The backend's supported-provider order is the curated common-provider
  // order. Keep the home glance familiar; risk remains visible in the status
  // pill, border tone, alert center, and full usage page.
  const compactCards = cards.slice(0, 2);

  if (cards.length === 0) return null;

  return (
    <section className="home-section usage-summary-section">
      <div className="usage-summary-heading">
        <div>
          <div className="home-section-title">{t('home.usageSummary')}</div>
          <p>{t('home.usageSummaryHint')}</p>
        </div>
        <div className="usage-summary-heading-actions">
          {visibleAlerts.length > 0 && (
            <div className="usage-summary-alert-center">
              <button
                type="button"
                className={`usage-summary-alert-toggle${alertCenterOpen ? ' is-open' : ''}`}
                onClick={() => setAlertCenterOpen(open => !open)}
                aria-expanded={alertCenterOpen}
                aria-controls="usage-summary-alert-list"
              >
                <span className="usage-summary-alert-toggle-dot" aria-hidden="true" />
                <span>{visibleAlerts.length} {t('home.usageAttention')}</span>
                <span className="usage-summary-alert-toggle-chevron" aria-hidden="true">⌄</span>
              </button>
              {alertCenterOpen && (
                <div id="usage-summary-alert-list" className="usage-summary-alert-popover" role="region" aria-label={t('home.usageAttention')}>
                  <div className="usage-summary-alert-popover-title">{t('home.usageAttention')}</div>
                  {visibleAlerts.map(alert => (
                    <div key={alert.notifyKey} className={`usage-summary-alert-item usage-summary-alert-item--${alert.severity}`}>
                      <span className="usage-summary-alert-item-dot" aria-hidden="true" />
                      <div className="usage-summary-alert-item-content">
                        <strong>{alert.providerName}</strong>
                        <span title={alert.message}>{compactAlertMessage(alert.message, alert.providerName)}</span>
                      </div>
                      <button
                        type="button"
                        className="usage-summary-alert-item-close"
                        onClick={() => setDismissedKeys(prev => new Set(prev).add(alert.notifyKey))}
                        aria-label={t('usage.dismissAlert')}
                        title={t('usage.dismissAlert')}
                      >×</button>
                    </div>
                  ))}
                  <button type="button" className="usage-summary-alert-all" onClick={() => navigate('/usage')}>
                    {t('usage.viewAll')} <span aria-hidden="true">↗</span>
                  </button>
                </div>
              )}
            </div>
          )}
          <button type="button" className="usage-summary-link" onClick={() => navigate('/usage')}>
            {t('usage.viewAll')} <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
      <div className="usage-summary-overview">
        <div className="usage-summary-compact-grid">
          {compactCards.map(c => (
            <UsageCompactCard
              key={c.id}
              card={c}
              alert={visibleAlerts.find(item => item.providerId === c.id)}
              t={t}
            />
          ))}
        </div>
        <div className="usage-summary-overview-side">
          <span className="usage-summary-overview-count">{cards.length}</span>
          <span>{t('home.usageProviders', { n: cards.length })}</span>
        </div>
      </div>
      <div className="usage-summary-footer">
        <span>{cards.length > compactCards.length ? t('home.usageMoreProviders', { n: cards.length - compactCards.length }) : t('home.usageSummaryHint')}</span>
        <button type="button" className="usage-summary-details-toggle" onClick={() => setDetailsOpen(open => !open)} aria-expanded={detailsOpen}>
          {detailsOpen ? t('home.collapse') : t('home.showAll')} <span aria-hidden="true">{detailsOpen ? '⌃' : '⌄'}</span>
        </button>
      </div>
      {detailsOpen && (
        <div className="usage-summary-grid">
        {cards.map(c => {
          const alert = visibleAlerts.find(item => item.providerId === c.id);
          const cardTone = alert?.severity || c.tone;
          return (
          <article key={c.id} className={`usage-summary-card usage-summary-card--${cardTone}${c.usage?.kind === 'prepaid' ? ' usage-summary-card--prepaid' : ''}${alert ? ` usage-summary-card--alert-${alert.severity}` : ''}`}>
            <div className="usage-summary-card-head">
              <div className="usage-summary-provider">
                {getProviderIcon(c.id) && <img src={getProviderIcon(c.id)} alt="" />}
                <span>{c.name}</span>
              </div>
              <span className={`usage-summary-status usage-summary-status--${cardTone}`}>
                {alert ? toneLabel(alert.severity, t) : c.usage?.kind === 'prepaid' ? t('home.usageBalance') : toneLabel(c.tone, t)}
              </span>
            </div>
            <RemainingWindows u={c.usage!} t={t} />
          </article>
          );
        })}
        </div>
      )}
    </section>
  );
}
