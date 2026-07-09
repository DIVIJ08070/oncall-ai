import { z } from 'zod';
import { LogLevelSchema } from './log.js';
import { ConfidenceSchema, DecisionSchema, EvidenceRefSchema } from './investigation.js';
import { PrKindSchema } from './github.js';

/**
 * Zod I/O schemas for the six agent tools + the `submit_findings` control tool (SPEC §9).
 * These schemas are the single source for the SDK `tool()` input typing and for the
 * bounded-output contracts. Caps (row/char/point limits) are encoded here where they can be.
 */

/* ── 1. search_logs — read `log_events` ─────────────────────────────────── */

export const SearchLogsInputSchema = z.object({
  service: z.string().optional(),
  level: LogLevelSchema.optional(),
  query: z.string().optional(),
  endpoint: z.string().optional(),
  status: z.number().int().optional(),
  since: z.number().int().optional(),
  until: z.number().int().optional(),
  limit: z.number().int().min(1).max(50).default(30),
});
export type SearchLogsInput = z.infer<typeof SearchLogsInputSchema>;

export const SearchLogsEventSchema = z.object({
  ts: z.number().int(),
  level: LogLevelSchema,
  message: z.string(),
  endpoint: z.string().nullable(),
  status: z.number().int().nullable(),
  latency_ms: z.number().int().nullable(),
  stack_excerpt: z.string().max(1200).nullable(),
});
export type SearchLogsEvent = z.infer<typeof SearchLogsEventSchema>;

export const LogPatternSchema = z.object({
  signature: z.string(),
  count: z.number().int(),
  sample: z.string(),
});
export type LogPattern = z.infer<typeof LogPatternSchema>;

export const SearchLogsOutputSchema = z.object({
  total_matched: z.number().int(),
  returned: z.number().int(),
  truncated: z.boolean(),
  events: z.array(SearchLogsEventSchema).max(50),
  patterns: z.array(LogPatternSchema),
});
export type SearchLogsOutput = z.infer<typeof SearchLogsOutputSchema>;

/* ── 2. get_metrics — read `metric_samples` ─────────────────────────────── */

export const GetMetricsInputSchema = z.object({
  service: z.string(),
  window_sec: z.number().int().min(1).max(3600).default(900),
  resolution_sec: z.number().int().min(1).default(15),
});
export type GetMetricsInput = z.infer<typeof GetMetricsInputSchema>;

export const GetMetricsSeriesPointSchema = z.object({
  ts: z.number().int(),
  error_rate: z.number(),
  req_count: z.number().int(),
  p95_ms: z.number().int(),
});
export type GetMetricsSeriesPoint = z.infer<typeof GetMetricsSeriesPointSchema>;

export const GetMetricsOutputSchema = z.object({
  service: z.string(),
  window_sec: z.number().int(),
  current: z.object({
    error_rate: z.number(),
    req_count: z.number().int(),
    p50_ms: z.number().int(),
    p95_ms: z.number().int(),
    p99_ms: z.number().int(),
  }),
  baseline: z.object({
    error_rate: z.number(),
    p95_ms: z.number().int(),
  }),
  series: z.array(GetMetricsSeriesPointSchema).max(60),
});
export type GetMetricsOutput = z.infer<typeof GetMetricsOutputSchema>;

/* ── 3. get_recent_deploys — real git log via Octokit ───────────────────── */

export const GetRecentDeploysInputSchema = z.object({
  limit: z.number().int().min(1).max(20).default(10),
});
export type GetRecentDeploysInput = z.infer<typeof GetRecentDeploysInputSchema>;

export const RecentDeploySchema = z.object({
  sha: z.string(),
  short_sha: z.string(),
  message_first_line: z.string(),
  author: z.string(),
  committed_at: z.number().int(),
  is_current: z.boolean(),
});
export type RecentDeploy = z.infer<typeof RecentDeploySchema>;

export const GetRecentDeploysOutputSchema = z.object({
  deploys: z.array(RecentDeploySchema).max(20),
});
export type GetRecentDeploysOutput = z.infer<typeof GetRecentDeploysOutputSchema>;

/* ── 4. get_deploy_diff — real diff via Octokit ─────────────────────────── */

export const GetDeployDiffInputSchema = z.union([
  z.object({ sha: z.string() }),
  z.object({ base: z.string(), head: z.string() }),
]);
export type GetDeployDiffInput = z.infer<typeof GetDeployDiffInputSchema>;

export const DiffFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch_excerpt: z.string(),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;

export const GetDeployDiffOutputSchema = z.object({
  base: z.string(),
  head: z.string(),
  total_files: z.number().int(),
  total_additions: z.number().int(),
  total_deletions: z.number().int(),
  truncated: z.boolean(),
  files: z.array(DiffFileSchema).max(20),
});
export type GetDeployDiffOutput = z.infer<typeof GetDeployDiffOutputSchema>;

/* ── 5. read_file — real file via Octokit ───────────────────────────────── */

export const ReadFileInputSchema = z.object({
  path: z.string(),
  ref: z.string().optional(),
  start_line: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
});
export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;

export const ReadFileOutputSchema = z.object({
  path: z.string(),
  ref: z.string(),
  total_lines: z.number().int(),
  returned_lines: z.number().int(),
  truncated: z.boolean(),
  content: z.string(),
});
export type ReadFileOutput = z.infer<typeof ReadFileOutputSchema>;

/* ── 6. create_fix_pr — the ONLY write tool ─────────────────────────────── */

export const CreateFixPrFileSchema = z.object({
  path: z.string(),
  content: z.string(),
});
export type CreateFixPrFile = z.infer<typeof CreateFixPrFileSchema>;

export const CreateFixPrInputSchema = z
  .object({
    kind: PrKindSchema,
    confidence: ConfidenceSchema,
    root_cause: z.string(),
    title: z.string(),
    body: z.string(),
    revert_sha: z.string().optional(),
    files: z.array(CreateFixPrFileSchema).optional(),
  })
  .refine((v) => (v.kind === 'revert' ? !!v.revert_sha : true), {
    message: 'revert_sha is required when kind="revert"',
    path: ['revert_sha'],
  })
  .refine((v) => (v.kind === 'patch' ? !!v.files && v.files.length > 0 : true), {
    message: 'files[] is required when kind="patch"',
    path: ['files'],
  });
export type CreateFixPrInput = z.infer<typeof CreateFixPrInputSchema>;

/** Success payload (SPEC §9 `create_fix_pr` output). */
export const CreateFixPrSuccessSchema = z.object({
  pr_number: z.number().int(),
  url: z.string(),
  branch: z.string(),
  head_sha: z.string(),
  base: z.string(),
});
export type CreateFixPrSuccess = z.infer<typeof CreateFixPrSuccessSchema>;

/** Refusal payload when `confidence < AGENT_CONFIDENCE_THRESHOLD` (SPEC §9 FR-13 gate). */
export const CreateFixPrRefusalSchema = z.object({
  escalate: z.literal(true),
  reason: z.string(),
});
export type CreateFixPrRefusal = z.infer<typeof CreateFixPrRefusalSchema>;

export const CreateFixPrOutputSchema = z.union([
  CreateFixPrSuccessSchema,
  CreateFixPrRefusalSchema,
]);
export type CreateFixPrOutput = z.infer<typeof CreateFixPrOutputSchema>;

/* ── control tool: submit_findings (7th allowlisted tool) ───────────────── */

export const SubmitFindingsInputSchema = z.object({
  root_cause: z.string(),
  evidence: z.array(EvidenceRefSchema),
  confidence: ConfidenceSchema,
  decision: DecisionSchema,
});
export type SubmitFindingsInput = z.infer<typeof SubmitFindingsInputSchema>;

export const SubmitFindingsOutputSchema = z.object({
  acknowledged: z.literal(true),
});
export type SubmitFindingsOutput = z.infer<typeof SubmitFindingsOutputSchema>;

/** Canonical allowlist of callable tool names (SPEC §9 sandbox = these exactly). */
export const AGENT_TOOL_NAMES = [
  'search_logs',
  'get_metrics',
  'get_recent_deploys',
  'get_deploy_diff',
  'read_file',
  'create_fix_pr',
  'submit_findings',
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];
