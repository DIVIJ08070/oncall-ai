import { z } from 'zod';
import { LogEventInputSchema, LogEventSchema, LogLevelSchema } from './log.js';
import { MetricsSnapshotSchema, ServiceHealthSchema } from './metrics.js';
import {
  IncidentSchema,
  IncidentSummarySchema,
  TimelineEntrySchema,
} from './incident.js';
import { PullRequestSummarySchema } from './github.js';
import {
  SessionSchema,
  StepSchema,
  EvidenceRefSchema,
} from './investigation.js';

/**
 * Request/response DTOs for every platform route (SPEC §7). Timestamps are epoch ms.
 */

/* ── Errors (SPEC §7 error body) ────────────────────────────────────────── */

export const ErrorCodeSchema = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_error',
  'rate_limited',
  'upstream_error',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ── 7.1 Ingestion ──────────────────────────────────────────────────────── */

export const IngestRequestSchema = z.object({
  events: z.array(LogEventInputSchema).min(1).max(500),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const IngestResponseSchema = z.object({
  accepted: z.number().int(),
  rejected: z.number().int(),
  errors: z.array(
    z.object({ index: z.number().int(), message: z.string() }),
  ),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

/* ── 7.2 Metrics & services ─────────────────────────────────────────────── */

export const ServicesResponseSchema = z.object({
  services: z.array(ServiceHealthSchema),
});
export type ServicesResponse = z.infer<typeof ServicesResponseSchema>;

export const MetricsQuerySchema = z.object({
  service: z.string(),
  window_sec: z.coerce.number().int().min(1).max(3600).default(900),
  resolution_sec: z.coerce.number().int().min(1).default(15),
});
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;

export const MetricsResponseSchema = MetricsSnapshotSchema;
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

/* ── 7.2b Logs ──────────────────────────────────────────────────────────── */

export const LogsQuerySchema = z.object({
  service: z.string().optional(),
  level: LogLevelSchema.optional(),
  since: z.coerce.number().int().optional(),
  until: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type LogsQuery = z.infer<typeof LogsQuerySchema>;

export const LogsResponseSchema = z.object({
  events: z.array(LogEventSchema),
  next_before: z.number().int().nullable(),
});
export type LogsResponse = z.infer<typeof LogsResponseSchema>;

/* ── 7.3 Incidents & investigation feed ─────────────────────────────────── */

export const IncidentsQuerySchema = z.object({
  status: z.string().optional(),
  service: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type IncidentsQuery = z.infer<typeof IncidentsQuerySchema>;

export const IncidentsListResponseSchema = z.object({
  incidents: z.array(IncidentSummarySchema),
});
export type IncidentsListResponse = z.infer<typeof IncidentsListResponseSchema>;

export const IncidentDetailResponseSchema = z.object({
  incident: IncidentSchema,
  session: SessionSchema.nullable(),
  steps: z.array(StepSchema),
  pull_request: PullRequestSummarySchema.nullable(),
  timeline: z.array(TimelineEntrySchema),
});
export type IncidentDetailResponse = z.infer<typeof IncidentDetailResponseSchema>;

export const InvestigateResponseSchema = z.object({
  session_id: z.string(),
});
export type InvestigateResponse = z.infer<typeof InvestigateResponseSchema>;

/* ── 7.4 Chat & postmortem ──────────────────────────────────────────────── */

export const ChatRequestSchema = z.object({
  message: z.string().min(1),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  evidence: z.array(EvidenceRefSchema).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatResponseSchema = z.object({
  message: ChatMessageSchema,
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const PostmortemResponseSchema = z.object({
  postmortem: z.string(),
});
export type PostmortemResponse = z.infer<typeof PostmortemResponseSchema>;

/* ── 7.5 GitHub OAuth & repo selection ──────────────────────────────────── */

export const UserSchema = z.object({
  id: z.string(),
  github_login: z.string(),
  avatar_url: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const AuthMeResponseSchema = z.object({
  user: UserSchema,
});
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

export const RepoRefSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  default_branch: z.string(),
  private: z.boolean(),
});
export type RepoRef = z.infer<typeof RepoRefSchema>;

export const ReposResponseSchema = z.object({
  repos: z.array(RepoRefSchema),
});
export type ReposResponse = z.infer<typeof ReposResponseSchema>;

export const RepoSelectRequestSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});
export type RepoSelectRequest = z.infer<typeof RepoSelectRequestSchema>;

export const CustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  github_owner: z.string().nullable(),
  github_repo: z.string().nullable(),
  default_branch: z.string(),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const RepoSelectResponseSchema = z.object({
  customer: CustomerSchema,
});
export type RepoSelectResponse = z.infer<typeof RepoSelectResponseSchema>;

/* ── 7.6 Integration snippet ────────────────────────────────────────────── */

export const IntegrationSnippetResponseSchema = z.object({
  ingest_url: z.string(),
  ingest_api_key: z.string(),
  middleware_snippet: z.string(),
  tailer_snippet: z.string(),
});
export type IntegrationSnippetResponse = z.infer<
  typeof IntegrationSnippetResponseSchema
>;

/* ── 7.7 Demo control & victim ──────────────────────────────────────────── */

/** Victim failure modes (SPEC §7.7, §12). */
export const FailureModeSchema = z.enum([
  'healthy',
  'bad_deploy',
  'slow_db',
  'config_error',
]);
export type FailureMode = z.infer<typeof FailureModeSchema>;

export const FailureModeRequestSchema = z.object({
  mode: FailureModeSchema,
});
export type FailureModeRequest = z.infer<typeof FailureModeRequestSchema>;

/** Platform `POST /demo/failure-mode` response (SPEC §7.7). */
export const FailureModeResponseSchema = z.object({
  mode: FailureModeSchema,
  deployed_sha: z.string().nullable(),
});
export type FailureModeResponse = z.infer<typeof FailureModeResponseSchema>;

/** Victim `POST /__control/failure-mode` response (SPEC §7.7). */
export const VictimFailureModeResponseSchema = z.object({
  mode: FailureModeSchema,
});
export type VictimFailureModeResponse = z.infer<
  typeof VictimFailureModeResponseSchema
>;

/** Victim `GET /__control/state` response (SPEC §7.7). */
export const VictimStateResponseSchema = z.object({
  mode: FailureModeSchema,
  deployed_sha: z.string().nullable(),
});
export type VictimStateResponse = z.infer<typeof VictimStateResponseSchema>;

/* ── 7.8 Health ─────────────────────────────────────────────────────────── */

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
