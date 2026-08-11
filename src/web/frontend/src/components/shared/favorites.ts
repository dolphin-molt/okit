// Goal ③: a tiny shared store for favorite + recent models.
//
// Multiple components (FavoriteButton instances, the home dashboard, pickers)
// need the same list. Rather than thread props or bloat AppContext, this module
// keeps an in-memory cache plus a subscriber set. The first caller fetches from
// the backend; everyone else reads the cache. Mutations update the cache and
// notify subscribers, so FavoriteButtons across the app stay in sync without a
// full page reload.

import { useEffect, useState, useCallback } from 'react';
import {
  getFavoriteModels,
  addFavoriteModel,
  removeFavoriteModel,
  FavoriteModel,
  RecentModel,
} from '../../api/providers';

interface FavoritesState {
  favorites: FavoriteModel[];
  recent: RecentModel[];
  loading: boolean;
}

let state: FavoritesState = { favorites: [], recent: [], loading: true };
const subscribers = new Set<() => void>();
let fetchPromise: Promise<void> | null = null;

function emit() {
  for (const fn of subscribers) fn();
}

async function ensureLoaded(): Promise<void> {
  if (!fetchPromise) {
    fetchPromise = (async () => {
      try {
        const data = await getFavoriteModels();
        state = { favorites: data.favorites, recent: data.recent, loading: false };
      } catch {
        state = { ...state, loading: false };
      }
      emit();
    })();
  }
  return fetchPromise;
}

export function useFavorites() {
  const [, force] = useState(0);
  useEffect(() => {
    const rerender = () => force(n => n + 1);
    subscribers.add(rerender);
    ensureLoaded();
    return () => { subscribers.delete(rerender); };
  }, []);

  const isFavorite = useCallback(
    (providerId: string, modelId: string) =>
      state.favorites.some(m => m.providerId === providerId && m.modelId === modelId),
    [],
  );

  const toggle = useCallback(async (providerId: string, modelId: string) => {
    const wasFav = state.favorites.some(m => m.providerId === providerId && m.modelId === modelId);
    // Optimistic update for snappy UI.
    state = {
      ...state,
      favorites: wasFav
        ? state.favorites.filter(m => !(m.providerId === providerId && m.modelId === modelId))
        : [...state.favorites, { providerId, modelId, addedAt: new Date().toISOString() }],
    };
    emit();
    try {
      const res = wasFav
        ? await removeFavoriteModel(providerId, modelId)
        : await addFavoriteModel(providerId, modelId);
      // Reconcile with server authoritatively.
      if (Array.isArray(res.favorites)) {
        state = { ...state, favorites: res.favorites };
        emit();
      }
    } catch {
      // Roll back on failure.
      await ensureLoaded();
    }
  }, []);

  return {
    favorites: state.favorites,
    recent: state.recent,
    loading: state.loading,
    isFavorite,
    toggle,
  };
}
