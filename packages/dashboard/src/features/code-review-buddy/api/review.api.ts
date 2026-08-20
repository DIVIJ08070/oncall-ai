import { api } from './axiosInstance';
import type { CustomRule, ReviewResult } from '../lib/types';

export interface ReviewRequestInput {
  diff: string;
  prTitle?: string;
  customRules: CustomRule[];
}

/** Tab 1 — review a pasted diff. */
export async function requestReview(input: ReviewRequestInput): Promise<ReviewResult> {
  const res = await api.post<ReviewResult>('/api/v1/code-review', input);
  return res.data;
}
