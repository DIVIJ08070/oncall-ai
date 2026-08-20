import { create } from 'zustand';

// Monotonic token: only the newest in-flight request may write results, and
// reset() bumps it too so a cleared review can't be repopulated by a late reply.
let requestSeq = 0;
import { getErrorMessage } from '../api/axiosInstance';
import { requestRepoReview } from '../api/repoReview.api';
import type { CustomRule, RepoReviewResult } from '../lib/types';

interface RepoReviewState {
  data: RepoReviewResult | null;
  loading: boolean;
  error: string | null;
  runRepoReview(input: { repoUrl: string; customRules: CustomRule[] }): Promise<void>;
  reset(): void;
}

export const useRepoReviewStore = create<RepoReviewState>((set) => ({
  data: null,
  loading: false,
  error: null,

  runRepoReview: async (input) => {
    const seq = ++requestSeq;
    set({ loading: true, error: null });
    try {
      const data = await requestRepoReview(input);
      if (seq !== requestSeq) return;
      set({ data, loading: false });
    } catch (err) {
      if (seq !== requestSeq) return;
      set({ error: getErrorMessage(err), loading: false });
    }
  },

  reset: () => {
    requestSeq++;
    set({ data: null, loading: false, error: null });
  },
}));
