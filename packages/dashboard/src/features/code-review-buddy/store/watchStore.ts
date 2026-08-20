import { create } from 'zustand';

// Monotonic token guarding background refreshes: only the newest snapshot may
// write, and every completed mutation bumps it so an in-flight (now stale)
// poll response can never clobber the mutation's result.
let requestSeq = 0;
import { getErrorMessage } from '../api/axiosInstance';
import { addWatch, getWatchState, removeWatch } from '../api/watch.api';
import type { AutoReview, WatchedRepo } from '../lib/types';
import { useRulesStore } from './rulesStore';

interface WatchStore {
  watches: WatchedRepo[];
  reviews: AutoReview[];
  /** True once the first refresh() has settled (distinguishes "empty" from "not fetched yet"). */
  loaded: boolean;
  /** True only while a user action (add / remove) is in flight — never for polls. */
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  add(repoUrl: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export const useWatchStore = create<WatchStore>((set, get) => ({
  watches: [],
  reviews: [],
  loaded: false,
  loading: false,
  error: null,

  // Interval-safe: never touches `loading` (no spinner flashes every 20s), and
  // a failed poll keeps the last good data on screen.
  refresh: async () => {
    const seq = ++requestSeq;
    try {
      const { watches, reviews } = await getWatchState();
      if (seq !== requestSeq) return;
      set({ watches, reviews, loaded: true });
    } catch (err) {
      if (seq !== requestSeq) return;
      set({ error: getErrorMessage(err), loaded: true });
    }
  },

  add: async (repoUrl) => {
    set({ loading: true, error: null });
    try {
      const watch = await addWatch({
        repoUrl,
        customRules: useRulesStore.getState().rules.filter((r) => r.enabled),
      });
      requestSeq++; // any poll snapshot taken before this mutation is now stale
      set((state) => ({ watches: [...state.watches, watch], loading: false }));
      void get().refresh();
    } catch (err) {
      set({ error: getErrorMessage(err), loading: false });
    }
  },

  remove: async (id) => {
    set({ loading: true, error: null });
    try {
      await removeWatch(id);
      requestSeq++; // see add()
      set((state) => ({
        watches: state.watches.filter((w) => w.id !== id),
        loading: false,
      }));
      void get().refresh();
    } catch (err) {
      set({ error: getErrorMessage(err), loading: false });
    }
  },
}));
