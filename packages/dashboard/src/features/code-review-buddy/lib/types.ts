/**
 * Code Review Buddy — shared data model (mini-app inside the OnCall AI
 * dashboard). Mirrors the server's response contracts exactly; every store,
 * api function, and component types against this file and nothing else.
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

/** Tab 1 — paste a diff. */
export interface ReviewResult {
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

/** Tab 2 — public GitHub repo. */
export interface RepoReviewResult {
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

/** Tab 4 — PR Watch: a registered repo the server polls for open PRs. */
export interface WatchedRepo {
  id: string;
  repoUrl: string;
  owner: string;
  repo: string;
  createdAt: number;
  rules: CustomRule[];
}

/** One automatic review of a (prNumber, headSha) pair on a watched repo. */
export interface AutoReview {
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
