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
export type NotificationChannel = 'slack' | 'email';
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

/* ── api_request_samples (AI Incident PREVENTION Phase 1) ────────────────── */
/**
 * One raw per-request telemetry sample. `id` is a BIGSERIAL surrogate (int8 → JS
 * number via the pool parser). `method` / `status_code` / `duration_ms` and the
 * request/response sizes are nullable — not every ingested request reports them.
 */
export interface ApiRequestSampleRow {
  id: number;
  service_name: string;
  endpoint: string;
  method: string | null;
  timestamp: number;
  status_code: number | null;
  duration_ms: number | null;
  request_size: number | null;
  response_size: number | null;
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

/* ── host_metric_samples (AI Incident PREVENTION — HOST early warning) ───── */
/**
 * One raw host/process resource reading. `id` is a BIGSERIAL surrogate (int8 →
 * JS number via the pool parser). `host` names the machine/process, `service`
 * the logical service it belongs to. The four metric columns are nullable — not
 * every host reports every metric (e.g. only a pool-owning process fills
 * `db_pool_pct`; only the victim reports `event_loop_lag_ms`).
 */
export interface HostMetricSampleRow {
  id: number;
  host: string;
  service: string;
  timestamp: number;
  cpu_pct: number | null;
  mem_pct: number | null;
  db_pool_pct: number | null;
  event_loop_lag_ms: number | null;
}

/* ── alerts (AI Incident PREVENTION — ESCALATE IF IGNORED ladder) ────────── */
/**
 * One durable early-warning alert per risky (service, metric/endpoint). Keyed by
 * the `risk_states` surrogate key (`risk_service`/`risk_endpoint`). `step` is the
 * highest ladder rung reached (`EARLY_RISK` | `WARNING` | `CRITICAL`, null before
 * the first escalation); `acknowledged` is a 0/1 flag (stops escalation);
 * `warning_at` records when the WARNING/email rung fired (the CRITICAL grace-timer
 * origin); `resolved_at` is set once the RECOVERY fires. `id` is a prefixed ULID.
 */
export interface AlertRow {
  id: string;
  source: string;
  service: string;
  metric: string;
  risk_service: string;
  risk_endpoint: string;
  title: string;
  status: string;
  step: string | null;
  current_value: number | null;
  threshold: number | null;
  probability: number | null;
  minutes_to_breach: number | null;
  likely_cause: string | null;
  recommended_action: string | null;
  /** 0/1 acknowledgement flag (SQLite-parity integer boolean). */
  acknowledged: number;
  acknowledged_at: number | null;
  acknowledged_by: string | null;
  first_detected_at: number;
  last_escalated_at: number | null;
  warning_at: number | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
}

/* ── alert_notifications (per-alert escalation timeline) ──────────────────── */
/**
 * One channel send in an alert's escalation timeline. `step` is the ladder rung
 * (`EARLY_RISK` | `WARNING` | `CRITICAL` | `RECOVERY`); `channel` the delivery
 * adapter; `payload` persists as JSON TEXT and is parsed back on read.
 */
export interface AlertNotificationRow {
  id: string;
  alert_id: string;
  step: string;
  channel: string;
  status: string;
  message: string;
  payload: unknown;
  created_at: number;
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
