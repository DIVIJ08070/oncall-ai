import { api } from './axiosInstance';
import type { CustomRule, RepoReviewResult } from '../lib/types';

export interface RepoReviewRequestInput {
  repoUrl: string;
  customRules: CustomRule[];
}

/** Tab 2 — scan a public GitHub repository. */
export async function requestRepoReview(
  input: RepoReviewRequestInput,
): Promise<RepoReviewResult> {
  const res = await api.post<RepoReviewResult>('/api/v1/code-review/repo', input);
  return res.data;
}
