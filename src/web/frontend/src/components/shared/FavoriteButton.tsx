// Goal ③: a star toggle for marking a model as favorite.
//
// Uses the shared favorites store (./favorites.ts) so every instance across
// the app (Models page rows, home dashboard chips) stays in sync. Renders an
// inline SVG star — filled when favorited, outline when not — to match the
// existing no-icon-library convention in this codebase.

import { useFavorites } from './favorites';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

interface Props {
  providerId: string;
  modelId: string;
  size?: number;
  /** When true the button is always visible; otherwise it only shows on hover. */
  alwaysVisible?: boolean;
}

export default function FavoriteButton({ providerId, modelId, size = 16, alwaysVisible = false }: Props) {
  const { isFavorite, toggle } = useFavorites();
  const { showToast } = useApp();
  const { t } = useI18n();
  const active = isFavorite(providerId, modelId);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await toggle(providerId, modelId);
    } catch {
      showToast(t('favorite.toggleError'), 'error');
    }
  };

  return (
    <button
      type="button"
      className={`favorite-btn${active ? ' favorite-btn--active' : ''}${alwaysVisible ? ' favorite-btn--always' : ''}`}
      onClick={handleClick}
      title={active ? t('favorite.remove') : t('favorite.add')}
      aria-label={active ? t('favorite.remove') : t('favorite.add')}
      aria-pressed={active}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}
