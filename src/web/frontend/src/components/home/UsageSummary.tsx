// Goal ②: a compact "today's usage" strip for the home dashboard.
//
// Surfaces the user's favorited providers' usage at a glance so the home page
// earns its "daily driver" role. Falls back to all supported providers when the
// user has no favorites yet. Each card shows one headline number: the highest
// window percentage for subscription providers, or the dollar balance for
// prepaid providers.

import { useEffect, useState, useCallback } from 'react';
import { getUsage, getSupportedUsageProviders, UsageResult } from '../../api/providers';
import { useFavorites } from '../shared/favorites';
import { useI18n } from '../../i18n';

const PROVIDER_NAME: Record<string, string> = {
  'openai-codex': 'Codex',
  'anthropic-agent': 'Claude',
  'google-agent': 'Gemini',
  'glm-coding': 'GLM',
  'kimi-coding-plan': 'Kimi',
  'minimax-coding': 'MiniMax',
  'volcengine-coding': '火山',
  'openrouter': 'OpenRouter',
  'deepseek': 'DeepSeek',
  'siliconflow': '硅基',
  'moonshot': 'Moonshot',
  'mistral': 'Mistral',
  'qwen': '通义',
};

export default function UsageSummary() {
  const { t } = useI18n();
  const { favorites } = useFavorites();
  const [supportedIds, setSupportedIds] = useState<string[]>([]);
  const [usageMap, setUsageMap] = useState<Record<string, UsageResult>>({});

  useEffect(() => {
    getSupportedUsageProviders()
      .then(sup => setSupportedIds(sup.providers || []))
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
    // Prefer favorited providers; fall back to all supported.
    const favIds = new Set(favorites.map(f => f.providerId));
    const target = supportedIds.filter(id => favIds.has(id));
    const ids = target.length > 0 ? target : supportedIds;
    // Cap at 6 to keep the strip compact.
    ids.slice(0, 6).forEach(id => fetchOne(id));
  }, [supportedIds, favorites, fetchOne]);

  const cards = supportedIds
    .filter(id => usageMap[id] && usageMap[id].supported !== false)
    .slice(0, 6)
    .map(id => {
      const u = usageMap[id];
      const w = u?.windows?.[0];
      let headline: string;
      let tone = 'ok';
      if (u?.kind === 'prepaid') {
        const rem = w?.remainingCredits;
        headline = rem != null ? `$${rem.toFixed(2)}` : '—';
        tone = 'ok';
      } else {
        const pct = w?.usedPercent;
        headline = pct != null ? `${Math.round(pct)}%` : '—';
        tone = pct == null ? 'unknown' : pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
      }
      return { id, name: PROVIDER_NAME[id] || id, headline, tone, label: w?.label || '' };
    });

  if (cards.length === 0) return null;

  return (
    <section className="home-section">
      <h3 className="home-section-title">{t('home.usageSummary')}</h3>
      <div className="usage-summary-grid">
        {cards.map(c => (
          <div key={c.id} className={`usage-summary-card usage-summary-card--${c.tone}`}>
            <span className="usage-summary-name">{c.name}</span>
            <span className="usage-summary-value">{c.headline}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
