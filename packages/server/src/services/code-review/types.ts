import type { ErrorCode } from '@oncall/shared';

/**
 * Code Review Buddy — server-side response contracts. Mirrors the dashboard's
 * shared model at `packages/dashboard/src/features/code-review-buddy/lib/types.ts`
 * exactly (the dashboard file is the canonical shape; keep the two in sync).
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'passed';

export type CategoryName =
  | 'Bugs'
  | 'Security'
  | 'Code Smells'
  | 'Missing Tests'
  | 'Best Practices'
  | 'Custom Rules';

export interface ReviewCategory {
  name: CategoryName;
  severity: Severity;
  summary: string;
  findings: string[];
}

/** `POST /api/v1/code-review` — paste-a-diff review. */
export interface ReviewResult {
  /** Which model reviewed: 'claude' (subscription, preferred) or 'gemini' (fallback). */
  engine?: 'claude' | 'gemini';
  prTitle?: string;
  overallScore: number;
  categories: ReviewCategory[];
  markdownComment: string;
}

/** One file inside a repo scan. */
export interface FileReviewResult {
  filePath: string;
  score: number;
  categories: ReviewCategory[];
}

/** `POST /api/v1/code-review/repo` — public GitHub repo scan. */
export interface RepoReviewResult {
  engine?: 'claude' | 'gemini';
  overallScore: number;
  repoUrl: string;
  filesReviewed: number;
  fileReviews: FileReviewResult[];
}

export type RuleCategory =
  | 'architecture'
  | 'folder-structure'
  | 'reusability'
  | 'code-hygiene'
  | 'naming'
  | 'custom';

export interface CustomRule {
  id: string;
  category: RuleCategory;
  description: string;
  severity: 'warning' | 'error';
  enabled: boolean;
}

/* ── PR Watch (auto-review poller) ──────────────────────────────────────── */

/** A GitHub repo registered for PR-Watch auto-review. */
export interface WatchedRepo {
  id: string;
  repoUrl: string;
  owner: string;
  repo: string;
  createdAt: number;
  rules: CustomRule[];
}

/** One stored auto-review of a `(prNumber, headSha)` pair. */
export interface AutoReview {
  engine?: 'claude' | 'gemini';
  id: string;
  watchId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  headSha: string;
  overallScore: number;
  categories: ReviewCategory[];
  markdownComment: string;
  commented: boolean;
  reviewedAt: number;
}

/**
 * Typed failure the route layer converts 1:1 into the SPEC §7 error envelope
 * via `sendError(reply, err.status, err.code, err.message)`.
 */
export class CodeReviewError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CodeReviewError';
  }
}
