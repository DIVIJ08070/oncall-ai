import type { EvidenceRef, LogEvent } from '@oncall/shared';

/**
 * DAO-level row types + codecs (SPEC §8).
 *
 * Most tables map 1:1 onto an `@oncall/shared` type (`Incident`, `Session`,
 * `Step`, `MetricSample`, `DeployRef`, `PullRequestRec`) and those DAOs reuse
 * the shared type directly. The types below cover the columns the public API
 * DTOs intentionally omit — e.g. `customers.ingest_api_key`, `users.access_token`,
 * `log_events.customer_id`, and the `services` / `chat_messages` / `notifications`
 * rows, which have no over-the-wire shape.
 */

/* ── customers ──────────────────────────────────────────────────────────── */
export interface CustomerRow {
  id: string;
  name: string;
  ingest_api_key: string;
  github_owner: string | null;
  github_repo: string | null;
  default_branch: string;
  created_at: number;
}

/* ── users ──────────────────────────────────────────────────────────────── */
export interface UserRow {
  id: string;
  github_user_id: number;
  github_login: string;
  avatar_url: string | null;
  /** GitHub OAuth token; plaintext in MVP (OQ-1 / NFR-08 roadmap). */
  access_token: string | null;
  customer_id: string | null;
  created_at: number;
}

/* ── services ───────────────────────────────────────────────────────────── */
export interface ServiceRow {
  id: string;
  customer_id: string;
  name: string;
  first_event_at: number | null;
  last_event_at: number | null;
}

/* ── log_events ─────────────────────────────────────────────────────────── */
/** Stored log row = the API `LogEvent` shape plus its owning `customer_id`. */
export type LogEventRow = LogEvent & { customer_id: string };

/* ── chat_messages ──────────────────────────────────────────────────────── */
export type ChatRole = 'user' | 'assistant';
export interface ChatMessageRow {
  id: string;
  incident_id: string | null;
  role: ChatRole;
  content: string;
  evidence: EvidenceRef[] | null;
  created_at: number;
}

/* ── notifications ──────────────────────────────────────────────────────── */
export type NotificationChannel = 'slack';
export type NotificationStatus = 'sent' | 'stubbed' | 'failed';
export interface NotificationRow {
  id: string;
  incident_id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  payload: unknown;
  created_at: number;
}

/* ── repo_learnings ─────────────────────────────────────────────────────── */
/** Where a learning signal came from (explicit rating vs. PR lifecycle). */
export type LearningSource = 'rating' | 'merge' | 'closed' | 'review';
export interface RepoLearningRow {
  id: string;
  /** GitHub repo as `owner/name`. */
  repo: string;
  error_class: string;
  root_cause: string;
  fix_approach: string | null;
  source: LearningSource;
  /** Net feedback signal: negative = downvoted, positive = upvoted. */
  rating: number;
  note: string | null;
  /** How many times the same repo+error_class+root_cause was re-confirmed. */
  confirmations: number;
  pr_number: number | null;
  created_at: number;
  updated_at: number;
}

/* ── api_performance_samples (AI Incident PREVENTION Phase 1) ────────────── */
/**
 * One derived performance profile per (service, endpoint) per rollup window.
 * All numeric columns are NOT NULL (the compute layer always fills them, using
 * 0 where a window has no data); only the free-text `prediction` is optional.
 * `id` is a BIGSERIAL surrogate key (int8 → JS number via the pool parser).
 */
export interface ApiPerformanceSampleRow {
  id: number;
  service_name: string;
  endpoint: string;
  method: string;
  window_start: number;
  window_end: number;
  request_count: number;
  rps: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  error_rate: number;
  timeout_rate: number;
  performance_score: number;
  risk_score: number;
  /** Human-readable trend prediction, e.g. "may breach in ~14 min (87%)". */
  prediction: string | null;
}

/* ── risk_states (AI Incident PREVENTION Phase 1) ───────────────────────── */
/**
 * Durable per-(service, endpoint) escalation state. `status` is an app-level
 * label (e.g. `healthy` | `watch` | `at_risk`); the two `consecutive_*` streaks
 * default to 0. `prediction_details` holds the serialized prediction payload
 * (JSON TEXT). `id` is a BIGSERIAL surrogate key.
 */
export interface RiskStateRow {
  id: number;
  service_name: string;
  endpoint: string;
  status: string;
  first_detected_at: number | null;
  last_escalated_at: number | null;
  consecutive_risk_windows: number;
  consecutive_healthy_windows: number;
  current_risk_score: number | null;
  prediction_details: string | null;
  updated_at: number;
}

/* ── codecs (JSON columns + SQLite 0/1 booleans) ────────────────────────── */

/** Serialize a value for a JSON TEXT column (`null`/`undefined` → SQL NULL). */
export function toJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

/** Parse a JSON TEXT column back to `T` (SQL NULL → `null`). */
export function fromJson<T>(text: string | null): T | null {
  if (text === null || text === undefined) return null;
  return JSON.parse(text) as T;
}

/** SQLite has no boolean type: booleans persist as INTEGER 0/1. */
export function boolToInt(b: boolean): 0 | 1 {
  return b ? 1 : 0;
}

export function intToBool(n: number): boolean {
  return n !== 0;
}
