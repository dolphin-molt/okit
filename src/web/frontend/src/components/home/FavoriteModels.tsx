// Goal ②: a "favorite models" chip grid for the home dashboard.
//
// Renders up to 6 starred models. Clicking a chip opens a small popover listing
// the agents that are compatible with that provider, letting the user switch
// the external CLI's active model without leaving the home page. Uses the
// switchProvider endpoint (goal ④ unified path).

import { useState, useRef, useEffect } from 'react';
import { getAdapters, switchProvider, AgentInfo } from '../../api/providers';
import { useFavorites } from '../shared/favorites';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

export default function FavoriteModels() {
  const { t } = useI18n();
  const { showToast } = useApp();
  const { favorites, loading } = useFavorites();
  const [adapters, setAdapters] = useState<AgentInfo[]>([]);
  const [openChip, setOpenChip] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAdapters().then(data => setAdapters(data.adapters || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!openChip) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenChip(null);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [openChip]);

  const handleSwitch = async (agentId: string, providerId: string, modelId: string, chipKey: string) => {
    setSwitching(`${agentId}:${chipKey}`);
    try {
      await switchProvider(agentId, providerId, modelId);
      showToast(t('agents.switchSuccess'), 'success');
      setOpenChip(null);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSwitching(null);
    }
  };

  const chips = favorites.slice(0, 6);

  if (!loading && chips.length === 0) {
    return (
      <section className="home-section">
        <h3 className="home-section-title">{t('home.favoriteModels')}</h3>
        <p className="home-empty-hint">{t('home.noFavorites')}</p>
      </section>
    );
  }

  return (
    <section className="home-section">
      <h3 className="home-section-title">{t('home.favoriteModels')}</h3>
      <div className="fav-model-grid">
        {chips.map(f => {
          const key = `${f.providerId}/${f.modelId}`;
          // Which agents can use this provider?
          const compatible = adapters.filter(a =>
            a.compatibleProviders?.some(p => p.id === f.providerId),
          );
          const providerName = adapters
            .flatMap(a => a.compatibleProviders || [])
            .find(p => p.id === f.providerId)?.name || f.providerId;
          return (
            <div key={key} className="fav-model-chip-wrap">
              <button
                type="button"
                className="fav-model-chip"
                onClick={() => setOpenChip(openChip === key ? null : key)}
              >
                <span className="fav-model-name">{f.modelId}</span>
                <span className="fav-model-provider">{providerName}</span>
              </button>
              {openChip === key && (
                <div className="fav-model-popover" ref={popoverRef}>
                  <div className="fav-model-popover-title">{t('home.launch')}:</div>
                  {compatible.length === 0 ? (
                    <div className="fav-model-popover-empty">—</div>
                  ) : (
                    compatible.map(a => (
                      <button
                        key={a.id}
                        type="button"
                        className="fav-model-popover-item"
                        disabled={switching === `${a.id}:${key}`}
                        onClick={() => handleSwitch(a.id, f.providerId, f.modelId, key)}
                      >
                        {a.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
