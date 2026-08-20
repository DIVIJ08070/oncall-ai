import { create } from 'zustand';

// Monotonic token: only the newest in-flight request may write results, and
// reset() bumps it too so a cleared review can't be repopulated by a late reply.
let requestSeq = 0;
import { getErrorMessage } from '../api/axiosInstance';
import { requestReview } from '../api/review.api';
import type { CustomRule, ReviewResult } from '../lib/types';

interface ReviewState {
  data: ReviewResult | null;
  loading: boolean;
  error: string | null;
  runReview(input: { diff: string; prTitle?: string; customRules: CustomRule[] }): Promise<void>;
  reset(): void;
}

export const useReviewStore = create<ReviewState>((set) => ({
  data: null,
  loading: false,
  error: null,

  runReview: async (input) => {
    const seq = ++requestSeq;
    set({ loading: true, error: null });
    try {
      const data = await requestReview(input);
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
