import type {
  Confidence,
  Decision,
  Detector,
  DeployRef,
  DeploySource,
  EvidenceRef,
  Incident,
  IncidentStatus,
  LogLevel,
  MetricSample,
  PrKind,
  PrState,
  PullRequestRec,
  Session,
  SessionMode,
  SessionStatus,
  Severity,
  Step,
  StepType,
  VerificationStatus,
} from '@oncall/shared';
import type {
  AlertNotificationRow,
  AlertRow,
  ApiPerformanceSampleRow,
  ApiRequestSampleRow,
  ChatMessageRow,
  ChatRole,
  CustomerRow,
  HostMetricSampleRow,
  LearningSource,
  LogEventRow,
  NotificationChannel,
  NotificationRow,
  NotificationStatus,
  RepoLearningRow,
  RiskStateRow,
  ServiceRow,
  UserRow,
} from '../rows.js';

/**
 * The shared **async DAO contract** (dual-driver persistence).
 *
 * Every method returns a `Promise` and every driver (better-sqlite3, pg)
 * implements these exact interfaces with identical row shapes (`rows.ts` +
 * `@oncall/shared` types stay the contract). The sqlite classes live in
 * `db/dao/*.ts` (async wrappers over the sync driver); the postgres classes
 * live in `db/pg/dao/*.ts`. Consumers depend only on these interfaces via
 * `OncallDb.dao`.
 */

/* ── customers ──────────────────────────────────────────────────────────── */

export interface CreateCustomerInput {
  name: string;
  ingest_api_key: string;
  github_owner?: string | null;
  github_repo?: string | null;
  default_branch?: string;
  id?: string;
  created_at?: number;
}

export interface CustomersDao {
  create(input: CreateCustomerInput): Promise<CustomerRow>;
  getById(id: string): Promise<CustomerRow | null>;
  getByIngestKey(key: string): Promise<CustomerRow | null>;
  list(): Promise<CustomerRow[]>;
  /** Bind a customer to a selected GitHub repo (SPEC §7.5 repo select). */
  setRepo(
    id: string,
    owner: string,
    repo: string,
    defaultBranch: string,
  ): Promise<CustomerRow | null>;
}

/* ── users ──────────────────────────────────────────────────────────────── */

export interface UpsertUserInput {
  github_user_id: number;
  github_login: string;
  avatar_url?: string | null;
  access_token?: string | null;
  customer_id?: string | null;
}

export interface UsersDao {
  getById(id: string): Promise<UserRow | null>;
  getByGithubUserId(githubUserId: number): Promise<UserRow | null>;
  /** Insert on first sign-in, else refresh login/avatar/token in place. */
  upsertByGithubUserId(input: UpsertUserInput): Promise<UserRow>;
}

/* ── services ───────────────────────────────────────────────────────────── */

export interface ServicesDao {
  getByName(customerId: string, name: string): Promise<ServiceRow | null>;
  getById(id: string): Promise<ServiceRow | null>;
  listByCustomer(customerId: string): Promise<ServiceRow[]>;
  /**
   * Upsert a service and advance timestamps. Idempotent per (customer, name):
   * inserts on first sight (`first_event_at` = `last_event_at` = `eventAt`),
   * otherwise moves `last_event_at` forward (never backward).
   */
  touch(customerId: string, name: string, eventAt: number): Promise<ServiceRow>;
}

/* ── log_events ─────────────────────────────────────────────────────────── */

/** SPEC §8: `stack` "truncated to 8KB on write". */
export const STACK_MAX_BYTES = 8 * 1024;

/** Truncate a string to at most `STACK_MAX_BYTES` UTF-8 bytes. */
export function truncateStack(stack: string | null | undefined): string | null {
  if (stack === null || stack === undefined) return null;
  const buf = Buffer.from(stack, 'utf8');
  if (buf.length <= STACK_MAX_BYTES) return stack;
  // Slice on a byte boundary, then repair any split multibyte tail.
  return buf.subarray(0, STACK_MAX_BYTES).toString('utf8');
}

export interface CreateLogEventInput {
  customer_id: string;
  service: string;
  level: LogLevel;
  message: string;
  timestamp?: number;
  received_at?: number;
  stack?: string | null;
  endpoint?: string | null;
  method?: string | null;
  status?: number | null;
  latency_ms?: number | null;
  fingerprint_sig?: string | null;
  id?: string;
}

export interface LogQuery {
  customer_id?: string;
  service?: string;
  level?: LogLevel;
  since?: number;
  until?: number;
  /** Keyset pagination: only rows with `timestamp < before`. */
  before?: number;
  limit?: number;
}

export interface LogEventsDao {
  insert(input: CreateLogEventInput): Promise<LogEventRow>;
  /** Batch insert in one transaction (ingest accepts ≤500 events/request). */
  insertMany(inputs: CreateLogEventInput[]): Promise<LogEventRow[]>;
  getById(id: string): Promise<LogEventRow | null>;
  /** Filtered log query, newest-first, keyset-paginated by `timestamp`. */
  query(q?: LogQuery): Promise<LogEventRow[]>;
  countByCustomer(customerId: string): Promise<number>;
}

/* ── metric_samples ─────────────────────────────────────────────────────── */

export type CreateMetricSampleInput = Omit<MetricSample, 'id'>;

export interface MetricSamplesDao {
  insert(input: CreateMetricSampleInput): Promise<MetricSample>;
  /** Most recent sample for a service (highest `bucket_ts`). */
  latestForService(
    customerId: string,
    service: string,
  ): Promise<MetricSample | null>;
  /** Ascending time series for a service since `sinceTs` (capped by `limit`). */
  seriesForService(
    customerId: string,
    service: string,
    sinceTs: number,
    limit?: number,
  ): Promise<MetricSample[]>;
}

/* ── incidents ──────────────────────────────────────────────────────────── */

/** Statuses at which an incident no longer dedups new breaches (SPEC §8/§10.4). */
export const TERMINAL_STATUSES: readonly IncidentStatus[] = [
  'resolved',
  'closed',
];

export function isTerminalStatus(status: IncidentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface OpenIncidentInput {
  customer_id: string;
  service: string;
  detector: Detector;
  fingerprint: string;
  title: string;
  severity: Severity;
  threshold_value: number;
  observed_value: number;
  status?: IncidentStatus;
  first_error_at?: number | null;
  detected_at?: number;
  opened_at?: number;
  suspect_deploy_sha?: string | null;
}

export interface OpenResult {
  incident: Incident;
  /** `true` when an existing non-terminal incident was updated (deduped). */
  deduped: boolean;
}

/** Fields the lifecycle / agent / recovery flows patch onto an incident. */
export type IncidentPatch = Partial<
  Pick<
    Incident,
    | 'status'
    | 'severity'
    | 'observed_value'
    | 'threshold_value'
    | 'root_cause'
    | 'confidence'
    | 'pr_id'
    | 'suspect_deploy_sha'
    | 'first_error_at'
    | 'resolved_at'
    | 'postmortem'
  >
>;

export interface IncidentsQuery {
  customer_id?: string;
  service?: string;
  status?: IncidentStatus;
  /** Only incidents in a non-terminal status. */
  activeOnly?: boolean;
  limit?: number;
}

export interface IncidentsDao {
  getById(id: string): Promise<Incident | null>;
  /** The non-terminal incident (if any) matching the dedup key. */
  findActiveByFingerprint(
    customerId: string,
    service: string,
    fingerprint: string,
  ): Promise<Incident | null>;
  /**
   * Code-enforced dedup (SPEC §8). Atomic: find-or-insert in one transaction.
   * On a live duplicate, only `observed_value`/`updated_at` advance.
   */
  openOrDedup(input: OpenIncidentInput): Promise<OpenResult>;
  /** Patch arbitrary lifecycle fields; always bumps `updated_at`. */
  update(id: string, patch: IncidentPatch): Promise<Incident | null>;
  setStatus(id: string, status: IncidentStatus): Promise<Incident | null>;
  list(q?: IncidentsQuery): Promise<Incident[]>;
}

/* ── investigation_sessions ─────────────────────────────────────────────── */

export interface CreateSessionInput {
  incident_id: string;
  mode: SessionMode;
  model: string;
  status?: SessionStatus;
  started_at?: number;
  iterations?: number;
  id?: string;
}

export type SessionPatch = Partial<
  Pick<
    Session,
    | 'status'
    | 'completed_at'
    | 'iterations'
    | 'root_cause'
    | 'confidence'
    | 'decision'
    | 'summary'
    | 'input_tokens'
    | 'output_tokens'
    | 'cost_usd'
  >
>;

export interface FinishSessionFields {
  status: SessionStatus;
  root_cause?: string | null;
  confidence?: Confidence | null;
  decision?: Decision | null;
  summary?: string | null;
  iterations?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  completed_at?: number;
}

export interface InvestigationSessionsDao {
  create(input: CreateSessionInput): Promise<Session>;
  getById(id: string): Promise<Session | null>;
  /** Most recent session for an incident. */
  latestForIncident(incidentId: string): Promise<Session | null>;
  listByIncident(incidentId: string): Promise<Session[]>;
  update(id: string, patch: SessionPatch): Promise<Session | null>;
  /** Convenience for the terminal `submit_findings` write (FR-08). */
  finish(id: string, fields: FinishSessionFields): Promise<Session | null>;
}

/* ── investigation_steps ────────────────────────────────────────────────── */

export interface AppendStepInput {
  session_id: string;
  type: StepType;
  tool_name?: string | null;
  tool_input?: unknown;
  tool_output?: unknown;
  content?: string | null;
  /** Override the auto-assigned sequence (tests / replay). */
  seq?: number;
  created_at?: number;
  id?: string;
}

/** A step as stored, with `tool_input`/`tool_output` parsed from JSON. */
export interface StoredStep extends Step {
  id: string;
  session_id: string;
  seq: number;
  created_at: number;
}

export interface InvestigationStepsDao {
  /** Append a step; assigns `seq` and `id` atomically. */
  append(input: AppendStepInput): Promise<StoredStep>;
  listBySession(sessionId: string): Promise<StoredStep[]>;
  countBySession(sessionId: string): Promise<number>;
}

/* ── deploys ────────────────────────────────────────────────────────────── */

export interface UpsertDeployInput {
  customer_id: string;
  sha: string;
  short_sha: string;
  ref: string;
  message: string;
  author: string;
  committed_at: number;
  source: DeploySource;
  deployed_at?: number | null;
  is_current?: boolean;
  pr_id?: string | null;
  created_at?: number;
  id?: string;
}

export interface DeploysDao {
  /** Insert, or update in place when (customer_id, sha) already exists. */
  upsert(input: UpsertDeployInput): Promise<DeployRef>;
  getBySha(customerId: string, sha: string): Promise<DeployRef | null>;
  getCurrent(customerId: string): Promise<DeployRef | null>;
  listRecent(customerId: string, limit?: number): Promise<DeployRef[]>;
  /** Mark exactly one commit current for a customer (clears the rest). */
  markCurrent(customerId: string, sha: string): Promise<DeployRef | null>;
}

/* ── pull_requests ──────────────────────────────────────────────────────── */

export interface CreatePullRequestInput {
  incident_id: string;
  customer_id: string;
  github_pr_number: number;
  github_pr_id: number;
  branch: string;
  base_branch: string;
  title: string;
  url: string;
  kind: PrKind;
  diagnostic_report: string;
  head_sha: string;
  state?: PrState;
  verification_status?: VerificationStatus;
  created_at?: number;
  id?: string;
}

export type PullRequestPatch = Partial<
  Pick<
    PullRequestRec,
    | 'state'
    | 'merged_at'
    | 'verification_status'
    | 'verification_comment_id'
    | 'head_sha'
    | 'url'
  >
>;

export interface PullRequestsDao {
  create(input: CreatePullRequestInput): Promise<PullRequestRec>;
  getById(id: string): Promise<PullRequestRec | null>;
  getByIncident(incidentId: string): Promise<PullRequestRec | null>;
  /** PRs awaiting merge (merge poller scans these — §10.5). */
  listByState(customerId: string, state: PrState): Promise<PullRequestRec[]>;
  update(id: string, patch: PullRequestPatch): Promise<PullRequestRec | null>;
}

/* ── chat_messages ──────────────────────────────────────────────────────── */

export interface CreateChatMessageInput {
  incident_id: string | null;
  role: ChatRole;
  content: string;
  evidence?: EvidenceRef[] | null;
  created_at?: number;
  id?: string;
}

export interface ChatMessagesDao {
  insert(input: CreateChatMessageInput): Promise<ChatMessageRow>;
  listByIncident(incidentId: string): Promise<ChatMessageRow[]>;
}

/* ── notifications ──────────────────────────────────────────────────────── */

export interface CreateNotificationInput {
  incident_id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  payload: unknown;
  created_at?: number;
  id?: string;
}

export interface NotificationsDao {
  insert(input: CreateNotificationInput): Promise<NotificationRow>;
  listByIncident(incidentId: string): Promise<NotificationRow[]>;
}

/* ── repo_learnings ─────────────────────────────────────────────────────── */

export interface CreateRepoLearningInput {
  /** GitHub repo as `owner/name`. */
  repo: string;
  error_class: string;
  root_cause: string;
  fix_approach?: string | null;
  source: LearningSource;
  /** Feedback signal, typically -1 or 1 (default 0). */
  rating?: number;
  note?: string | null;
  pr_number?: number | null;
  created_at?: number;
  id?: string;
}

export interface RepoLearningStats {
  total: number;
  positive: number;
  negative: number;
  bySource: Record<string, number>;
}

export interface RepoLearningsDao {
  create(input: CreateRepoLearningInput): Promise<RepoLearningRow>;
  getById(id: string): Promise<RepoLearningRow | null>;
  /** Newest-first learnings for a repo (dashboard list). */
  listByRepo(repo: string, limit?: number): Promise<RepoLearningRow[]>;
  /**
   * The `n` strongest learnings for prompt injection: positively-rated rows
   * first, then most-confirmed, then most recently updated.
   */
  topForPrompt(repo: string, n: number): Promise<RepoLearningRow[]>;
  stats(repo: string): Promise<RepoLearningStats>;
  /**
   * Reinforce an existing learning or record a new one. A row matches on
   * repo + error_class + root_cause (case-insensitive).
   */
  confirmOrCreate(input: CreateRepoLearningInput): Promise<RepoLearningRow>;
}

/* ── api_performance_samples (AI Incident PREVENTION Phase 1) ────────────── */

/** Upsert payload for one performance window (id is BIGSERIAL, assigned by DB). */
export interface UpsertApiPerformanceSampleInput {
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
  prediction?: string | null;
}

export interface ApiPerformanceDao {
  /**
   * Insert one window's performance sample, or overwrite it in place when the
   * same (service_name, endpoint, window_start) already exists. Returns the
   * stored row (with its DB-assigned `id`).
   */
  upsertWindow(
    sample: UpsertApiPerformanceSampleInput,
  ): Promise<ApiPerformanceSampleRow>;
  /**
   * The most-recent sample for every (service_name, endpoint) — one row per
   * endpoint, highest `window_start` wins. Optionally restrict to a set of
   * service names (a customer's owned services); omit for all services.
   */
  latestPerService(
    customerScope?: readonly string[],
  ): Promise<ApiPerformanceSampleRow[]>;
  /** Newest-first window history for a single endpoint (capped by `limit`). */
  listRecentForEndpoint(
    service: string,
    endpoint: string,
    limit?: number,
  ): Promise<ApiPerformanceSampleRow[]>;
}

/* ── risk_states (AI Incident PREVENTION Phase 1) ───────────────────────── */

/** Upsert payload for a per-endpoint risk state (id is BIGSERIAL, DB-assigned). */
export interface UpsertRiskStateInput {
  service_name: string;
  endpoint: string;
  status: string;
  first_detected_at?: number | null;
  last_escalated_at?: number | null;
  consecutive_risk_windows?: number;
  consecutive_healthy_windows?: number;
  current_risk_score?: number | null;
  prediction_details?: string | null;
  updated_at?: number;
}

export interface RiskStatesDao {
  /** The risk state for one endpoint, or `null` if none tracked yet. */
  get(service: string, endpoint: string): Promise<RiskStateRow | null>;
  /**
   * Insert, or update in place on (service_name, endpoint). Streak/score/status
   * fields are replaced by the supplied values; `updated_at` defaults to now,
   * the `consecutive_*` counters default to 0 on first insert.
   */
  upsert(state: UpsertRiskStateInput): Promise<RiskStateRow>;
  /** Every tracked risk state (dashboard overview). */
  listAll(): Promise<RiskStateRow[]>;
}

/* ── api_request_samples (AI Incident PREVENTION Phase 1) ────────────────── */

/** Insert payload for one raw request sample (id is BIGSERIAL, DB-assigned). */
export interface CreateApiRequestSampleInput {
  service_name: string;
  endpoint: string;
  method?: string | null;
  timestamp: number;
  status_code?: number | null;
  duration_ms?: number | null;
  request_size?: number | null;
  response_size?: number | null;
}

/** A distinct endpoint seen in a window (representative, most-recent `method`). */
export interface ApiRequestEndpoint {
  service_name: string;
  endpoint: string;
  method: string | null;
}

/**
 * One endpoint's rolled-up window, computed in a single grouped query (Rule 2).
 * `durations` is the raw latency array for JS-side percentile computation
 * (mirrors the metric rollups); `count` sizes RPS; `errorCount`/`timeoutCount`
 * feed the error/timeout rates.
 */
export interface ApiRequestWindowAgg {
  count: number;
  errorCount: number;
  timeoutCount: number;
  durations: number[];
}

export interface ApiRequestSamplesDao {
  /** Batch insert raw request samples; returns the number of rows written. */
  insertMany(rows: CreateApiRequestSampleInput[]): Promise<number>;
  /**
   * Roll one endpoint's `[fromTs, toTs]` window up in a single grouped query.
   * A request counts as an error when `status_code >= 500`, and as a timeout
   * when `status_code = 504` or `duration_ms > timeoutMs`.
   */
  aggregateWindow(
    service: string,
    endpoint: string,
    fromTs: number,
    toTs: number,
    timeoutMs?: number,
  ): Promise<ApiRequestWindowAgg>;
  /** Distinct (service, endpoint) seen in the window, with a representative method. */
  listEndpointsInWindow(
    fromTs: number,
    toTs: number,
  ): Promise<ApiRequestEndpoint[]>;
  /**
   * Delete rows older than `cutoffTs` in bounded batches (default 500) until the
   * tail is drained. Returns the total number of rows deleted.
   */
  pruneOlderThanInBatches(
    cutoffTs: number,
    batchSize?: number,
  ): Promise<number>;
}

/* ── host_metric_samples (AI Incident PREVENTION — HOST early warning) ───── */

/** Insert payload for one raw host reading (id is BIGSERIAL, DB-assigned). */
export interface CreateHostMetricSampleInput {
  host: string;
  service: string;
  timestamp: number;
  cpu_pct?: number | null;
  mem_pct?: number | null;
  db_pool_pct?: number | null;
  event_loop_lag_ms?: number | null;
}

/** Physical `host_metric_samples` column backing a `HostMetricName`. */
export type HostMetricColumn = 'cpu_pct' | 'mem_pct' | 'db_pool_pct';

/** One point of a metric's sparkline series: its timestamp + value. */
export interface HostMetricPoint {
  timestamp: number;
  value: number;
}

export interface HostMetricSamplesDao {
  /** Batch insert raw host readings; returns the number of rows written. */
  insertMany(rows: CreateHostMetricSampleInput[]): Promise<number>;
  /** Distinct `service` names with a sample in `[fromTs, toTs]`. */
  listServicesInWindow(fromTs: number, toTs: number): Promise<string[]>;
  /**
   * Newest-first non-null readings of one metric column for one service (capped
   * by `limit`) — the sparkline + trend source. Rows whose column is NULL are
   * skipped so a metric no host reports simply yields an empty series.
   */
  recentSeries(
    service: string,
    metric: HostMetricColumn,
    limit?: number,
  ): Promise<HostMetricPoint[]>;
  /** The most-recent full sample row for a service (highest `timestamp`). */
  latestForService(service: string): Promise<HostMetricSampleRow | null>;
}

/* ── alerts + alert_notifications (ESCALATE IF IGNORED ladder) ───────────── */

/** Insert payload for a new alert (id defaults to a fresh prefixed ULID). */
export interface CreateAlertInput {
  source: string;
  service: string;
  metric: string;
  risk_service: string;
  risk_endpoint: string;
  title: string;
  status: string;
  step?: string | null;
  current_value?: number | null;
  threshold?: number | null;
  probability?: number | null;
  minutes_to_breach?: number | null;
  likely_cause?: string | null;
  recommended_action?: string | null;
  acknowledged?: boolean;
  acknowledged_at?: number | null;
  acknowledged_by?: string | null;
  first_detected_at: number;
  last_escalated_at?: number | null;
  warning_at?: number | null;
  resolved_at?: number | null;
  created_at?: number;
  updated_at?: number;
  id?: string;
}

/** Fields the escalation engine + ack route patch onto an alert. */
export interface AlertPatch {
  status?: string;
  step?: string | null;
  current_value?: number | null;
  threshold?: number | null;
  probability?: number | null;
  minutes_to_breach?: number | null;
  likely_cause?: string | null;
  recommended_action?: string | null;
  acknowledged?: boolean;
  acknowledged_at?: number | null;
  acknowledged_by?: string | null;
  first_detected_at?: number;
  last_escalated_at?: number | null;
  warning_at?: number | null;
  resolved_at?: number | null;
  updated_at?: number;
}

export interface AlertsDao {
  getById(id: string): Promise<AlertRow | null>;
  /** The alert tracking one risk_states unit, or null if none. */
  getByRiskKey(
    riskService: string,
    riskEndpoint: string,
  ): Promise<AlertRow | null>;
  create(input: CreateAlertInput): Promise<AlertRow>;
  /** Patch lifecycle fields; always bumps `updated_at`. */
  update(id: string, patch: AlertPatch): Promise<AlertRow | null>;
  /**
   * Alerts that are still active (unresolved) OR resolved at/after
   * `resolvedSinceMs` (so the dashboard can render a brief RECOVERY notice),
   * most-recently-updated first.
   */
  listActive(resolvedSinceMs?: number): Promise<AlertRow[]>;
}

/** Insert payload for one escalation-timeline row. */
export interface CreateAlertNotificationInput {
  alert_id: string;
  step: string;
  channel: string;
  status: string;
  message: string;
  payload?: unknown;
  created_at?: number;
  id?: string;
}

export interface AlertNotificationsDao {
  insert(input: CreateAlertNotificationInput): Promise<AlertNotificationRow>;
  /** One alert's timeline, oldest → newest. */
  listByAlert(alertId: string): Promise<AlertNotificationRow[]>;
  /** Timelines for many alerts in one query, oldest → newest across all. */
  listByAlerts(alertIds: readonly string[]): Promise<AlertNotificationRow[]>;
}

/* ── the full DAO set ───────────────────────────────────────────────────── */

/** All typed DAOs, one per table (SPEC §8 + self-learning + prevention). */
export interface Daos {
  customers: CustomersDao;
  users: UsersDao;
  services: ServicesDao;
  logEvents: LogEventsDao;
  metricSamples: MetricSamplesDao;
  incidents: IncidentsDao;
  sessions: InvestigationSessionsDao;
  steps: InvestigationStepsDao;
  deploys: DeploysDao;
  pullRequests: PullRequestsDao;
  chatMessages: ChatMessagesDao;
  notifications: NotificationsDao;
  repoLearnings: RepoLearningsDao;
  apiPerformance: ApiPerformanceDao;
  riskStates: RiskStatesDao;
  apiRequestSamples: ApiRequestSamplesDao;
  hostMetricSamples: HostMetricSamplesDao;
  alerts: AlertsDao;
  alertNotifications: AlertNotificationsDao;
}
