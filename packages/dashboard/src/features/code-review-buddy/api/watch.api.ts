import { api } from './axiosInstance';
import type { AutoReview, CustomRule, WatchedRepo } from '../lib/types';

export interface WatchStateResponse {
  watches: WatchedRepo[];
  reviews: AutoReview[];
}

/** Tab 4 — current watches plus the auto-review feed (newest-first, cap 50). */
export async function getWatchState(): Promise<WatchStateResponse> {
  const res = await api.get<WatchStateResponse>('/api/v1/code-review/watch');
  return res.data;
}

/** Register a repo for automatic PR reviews. */
export async function addWatch(input: {
  repoUrl: string;
  customRules: CustomRule[];
}): Promise<WatchedRepo> {
  const res = await api.post<{ watch: WatchedRepo }>('/api/v1/code-review/watch', input);
  return res.data.watch;
}

/** Stop watching a repo. */
export async function removeWatch(id: string): Promise<void> {
  await api.delete(`/api/v1/code-review/watch/${encodeURIComponent(id)}`);
}
