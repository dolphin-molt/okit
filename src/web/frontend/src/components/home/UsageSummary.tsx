// Goal ②: a compact "today's usage" strip for the home dashboard.
//
// Surfaces remaining quota for all supported providers. Each card shows the REMAINING
// amount per window — not the used percentage — because "how much do I have
// left" is the daily-driver question. Subscription providers show every window
// they report (e.g. GLM shows both 5h and monthly; Codex shows 5h + weekly);
// prepaid providers show the dollar balance.

import { useEffect, useState, useCallback } from 'react';
import { getUsage, getSupportedUsageProviders, listProviders, UsageResult, UsageWindow } from '../../api/providers';
import { useI18n } from '../../i18n';

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
      <span className="usage-summary-balance">
        {rem != null ? (w.unit ? `${rem.toFixed(2)} ${w.unit}` : `$${rem.toFixed(2)}`) : '—'}
      </span>
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

  // Subscription: one row per window, each showing remaining %.
  return (
    <div className="usage-summary-windows">
      {windows.map((w, i) => {
        const used = w.usedPercent;
        const remaining = used != null ? Math.max(0, Math.round(100 - used)) : null;
        return (
          <div key={i} className={`usage-summary-window usage-summary-window--${toneForRemaining(remaining)}`}>
            <span className="usage-summary-window-label">{WINDOW_LABEL[w.label] || w.label}</span>
            <span className="usage-summary-window-value">
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

  const fetchOne = useCallback(async (id: string) => {
    try {
      const res = await getUsage(id);
      setUsageMap(prev => ({ ...prev, [id]: res }));
    } catch {
      /* ignore — the strip degrades to "no data" */
    }
  }, []);

  useEffect(() => {
    if (supportedIds.length === 0) return;
    supportedIds.forEach(id => fetchOne(id));
  }, [supportedIds, fetchOne]);

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

  if (cards.length === 0) return null;

  return (
    <section className="home-section">
      <h3 className="home-section-title">{t('home.usageSummary')}</h3>
      <div className="usage-summary-grid">
        {cards.map(c => (
          <div key={c.id} className={`usage-summary-card usage-summary-card--${c.tone}`}>
            <span className="usage-summary-name">{c.name}</span>
            <RemainingWindows u={c.usage!} t={t} />
          </div>
        ))}
      </div>
    </section>
  );
}
