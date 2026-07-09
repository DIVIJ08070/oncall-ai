import { z } from 'zod';

/**
 * GitHub / deploy domain (SPEC §8 `deploys` & `pull_requests`, §11 topology).
 */

/** Provenance of a deploy row (SPEC §8 `deploys.source`). */
export const DeploySourceSchema = z.enum([
  'baseline',
  'bad_deploy',
  'revert',
  'patch',
  'merge',
]);
export type DeploySource = z.infer<typeof DeploySourceSchema>;

/** A recorded deploy / commit used for correlation + recovery (SPEC §8 `deploys`). */
export const DeployRefSchema = z.object({
  id: z.string(),
  customer_id: z.string(),
  sha: z.string(),
  short_sha: z.string(),
  ref: z.string(),
  message: z.string(),
  author: z.string(),
  committed_at: z.number().int(),
  deployed_at: z.number().int().nullable(),
  is_current: z.boolean(),
  source: DeploySourceSchema,
  pr_id: z.string().nullable(),
  created_at: z.number().int(),
});
export type DeployRef = z.infer<typeof DeployRefSchema>;

/** Kind of fix the agent proposes (SPEC §8 / §9 `create_fix_pr`). */
export const PrKindSchema = z.enum(['revert', 'patch']);
export type PrKind = z.infer<typeof PrKindSchema>;

/** GitHub PR state we track (SPEC §8 `pull_requests.state`). */
export const PrStateSchema = z.enum(['open', 'merged', 'closed']);
export type PrState = z.infer<typeof PrStateSchema>;

/** Recovery-verification outcome (SPEC §8 / §10.5 / FR-12). */
export const VerificationStatusSchema = z.enum([
  'pending',
  'recovered',
  'not_recovered',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

/** Full pull-request record (SPEC §8 `pull_requests`, FR-09/10/12). */
export const PullRequestRecSchema = z.object({
  id: z.string(),
  incident_id: z.string(),
  customer_id: z.string(),
  github_pr_number: z.number().int(),
  github_pr_id: z.number().int(),
  branch: z.string(),
  base_branch: z.string(),
  title: z.string(),
  url: z.string(),
  kind: PrKindSchema,
  state: PrStateSchema,
  diagnostic_report: z.string(),
  head_sha: z.string(),
  created_at: z.number().int(),
  merged_at: z.number().int().nullable(),
  verification_status: VerificationStatusSchema,
  verification_comment_id: z.number().int().nullable(),
});
export type PullRequestRec = z.infer<typeof PullRequestRecSchema>;

/** Compact PR shape embedded in incident detail (SPEC §7.3 `pull_request`). */
export const PullRequestSummarySchema = z.object({
  number: z.number().int(),
  url: z.string(),
  kind: PrKindSchema,
  state: PrStateSchema,
  verification_status: VerificationStatusSchema,
  branch: z.string(),
  base: z.string(),
  head_sha: z.string(),
});
export type PullRequestSummary = z.infer<typeof PullRequestSummarySchema>;
