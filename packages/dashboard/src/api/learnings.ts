import { apiFetch } from './client';

/**
 * Self-learning API — per-repo learnings, stats and level, plus explicit 👍/👎
 * rating feedback. Kept in its own module (like `api/incidents.ts`) so features
 * extend the api layer without colliding on one file.
 */

/** Where a learning came from: explicit rating, or an automatic PR outcome. */
export type LearningSource = 'rating' | 'merge' | 'closed' | 'review';

/** One stored learning for a repo (camelCase mirror of `repo_learnings`). */
export interface Learning {
  id: string;
  errorClass: string;
  rootCause: string;
  fixApproach?: string;
  source: LearningSource;
  rating: number;
  note?: string;
  confirmations: number;
  prNumber?: number;
  createdAt: number;
}

/** Roll-up counts for a repo's learning memory. */
export interface LearningStats {
  total: number;
  positive: number;
  negative: number;
  bySource: Record<string, number>;
}

/** Level payload derived from `stats.total` (OBSERVER → ORACLE thresholds). */
export interface LearningLevel {
  index: number;
  name: string;
  total: number;
  nextAt: number | null;
  progress: number;
}

export interface RepoLearningsResponse {
  learnings: Learning[];
  stats: LearningStats;
  level: LearningLevel;
}

export interface RateLearningInput {
  repo: string;
  prNumber?: number;
  errorClass: string;
  rootCause: string;
  fixApproach?: string;
  rating: -1 | 1;
  note?: string;
}

export interface RateLearningResponse {
  ok: true;
  learning: Learning;
}

/** `GET /api/v1/learnings/:owner/:repo` — learnings + stats + level for one repo. */
export function getRepoLearnings(
  repo: string,
  signal?: AbortSignal,
): Promise<RepoLearningsResponse> {
  // `repo` is "owner/name"; split on the first slash so each path segment is
  // encoded independently (a name with a slash would 404 anyway).
  const slash = repo.indexOf('/');
  const owner = slash === -1 ? repo : repo.slice(0, slash);
  const name = slash === -1 ? '' : repo.slice(slash + 1);
  return apiFetch<RepoLearningsResponse>(
    `/learnings/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    { signal },
  );
}

/** `POST /api/v1/learnings/rate` — explicit 👍/👎 feedback; confirms or creates a learning. */
export function rateLearning(
  input: RateLearningInput,
  signal?: AbortSignal,
): Promise<RateLearningResponse> {
  return apiFetch<RateLearningResponse>('/learnings/rate', {
    method: 'POST',
    body: input,
    signal,
  });
}
