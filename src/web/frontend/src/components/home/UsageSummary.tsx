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

type Translate = (key: string, params?: Record<string, string | number>) => string;
const GROUP_PAGE_SIZE = 4;

function compactPrimaryValue(u: UsageResult, t: Translate): { value: string; detail: string } {
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

function UsageCompactCard({ card, alert, t }: { card: UsageCard; alert?: ReturnType<typeof checkAlerts>[number]; t: Translate }) {
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

function UsageGroupItem({ card, alert, t }: { card: UsageCard; alert?: ReturnType<typeof checkAlerts>[number]; t: Translate }) {
  const tone = alert?.severity || card.tone;
  const primary = compactPrimaryValue(card.usage, t);
  const firstWindow = card.usage.windows?.[0];
  const detail = card.usage.kind !== 'prepaid' && firstWindow?.unit && firstWindow.usedPercent != null
    ? `${t('home.usageRemaining')} · ${t('home.usageUsed')} ${firstWindow.usedPercent.toFixed(1)}%`
    : primary.detail;

  return (
    <article className={`usage-summary-group-item usage-summary-group-item--${tone}`}>
      <div className="usage-summary-group-item-head">
        <div className="usage-summary-provider">
          {getProviderIcon(card.id) && <img src={getProviderIcon(card.id)} alt="" />}
          <span>{card.name}</span>
        </div>
        <span className={`usage-summary-group-tone usage-summary-group-tone--${tone}`} aria-hidden="true" />
      </div>
      <div className="usage-summary-group-value">
        <strong>{primary.value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

function UsageGroupPanel({
  title,
  kind,
  cards,
  page,
  onPageChange,
  alerts,
  t,
}: {
  title: string;
  kind: 'quota' | 'balance';
  cards: UsageCard[];
  page: number;
  onPageChange: (page: number) => void;
  alerts: ReturnType<typeof checkAlerts>;
  t: Translate;
}) {
  if (cards.length === 0) return null;
  const pageCount = Math.max(1, Math.ceil(cards.length / GROUP_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageCards = cards.slice(safePage * GROUP_PAGE_SIZE, (safePage + 1) * GROUP_PAGE_SIZE);

  return (
    <section className={`usage-summary-group usage-summary-group--${kind}`}>
      <div className="usage-summary-group-heading">
        <div className="usage-summary-group-title">
          <span className="usage-summary-group-mark" aria-hidden="true" />
          <strong>{title}</strong>
          <span>{cards.length}</span>
        </div>
        {pageCount > 1 && (
          <div className="usage-summary-group-pager" aria-label={title}>
            <button type="button" onClick={() => onPageChange(safePage - 1)} disabled={safePage === 0} aria-label={t('home.usagePreviousPage')}>‹</button>
            <span>{safePage + 1} / {pageCount}</span>
            <button type="button" onClick={() => onPageChange(safePage + 1)} disabled={safePage === pageCount - 1} aria-label={t('home.usageNextPage')}>›</button>
          </div>
        )}
      </div>
      <div className="usage-summary-group-grid">
        {pageCards.map(card => (
          <UsageGroupItem
            key={card.id}
            card={card}
            alert={alerts.find(item => item.providerId === card.id)}
            t={t}
          />
        ))}
      </div>
    </section>
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
  const [quotaPage, setQuotaPage] = useState(0);
  const [balancePage, setBalancePage] = useState(0);

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
  const quotaCards = cards.filter(card => card.usage.kind !== 'prepaid');
  const balanceCards = cards.filter(card => card.usage.kind === 'prepaid');

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
          {detailsOpen ? t('home.collapse') : t('home.usageBrowse')} <span aria-hidden="true">{detailsOpen ? '⌃' : '⌄'}</span>
        </button>
      </div>
      {detailsOpen && (
        <div className="usage-summary-groups">
          <UsageGroupPanel
            title={t('home.usageQuotaGroup')}
            kind="quota"
            cards={quotaCards}
            page={quotaPage}
            onPageChange={setQuotaPage}
            alerts={visibleAlerts}
            t={t}
          />
          <UsageGroupPanel
            title={t('home.usageBalanceGroup')}
            kind="balance"
            cards={balanceCards}
            page={balancePage}
            onPageChange={setBalancePage}
            alerts={visibleAlerts}
            t={t}
          />
        </div>
      )}
    </section>
  );
}
