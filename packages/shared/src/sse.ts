import { z } from 'zod';
import { LogEventSchema } from './log.js';
import {
  StepSchema,
  SessionModeSchema,
  SessionStatusSchema,
  DecisionSchema,
  ConfidenceSchema,
} from './investigation.js';
import { PrKindSchema } from './github.js';

/**
 * SSE event union types (SPEC §7.2b logs stream, §7.3 investigation feed, §7.4 chat stream).
 * Wire frames are `event: <event>\ndata: <JSON of data>\n\n` plus a `:heartbeat` comment.
 */

/** Emitted on every stream as a keep-alive (SPEC §7 conventions). */
export const HeartbeatEventSchema = z.object({
  event: z.literal('heartbeat'),
  data: z.object({ ts: z.number().int() }),
});
export type HeartbeatEvent = z.infer<typeof HeartbeatEventSchema>;

/* ── Logs stream: GET /logs/stream (SPEC §7.2b) ─────────────────────────── */

export const LogStreamEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('log'), data: LogEventSchema }),
  HeartbeatEventSchema,
]);
export type LogStreamEvent = z.infer<typeof LogStreamEventSchema>;

/* ── Investigation feed: GET /incidents/:id/feed (SPEC §7.3) ─────────────── */

export const SessionStartedDataSchema = z.object({
  session_id: z.string(),
  mode: SessionModeSchema,
  model: z.string(),
});
export type SessionStartedData = z.infer<typeof SessionStartedDataSchema>;

export const PrCreatedDataSchema = z.object({
  number: z.number().int(),
  url: z.string(),
  kind: PrKindSchema,
});
export type PrCreatedData = z.infer<typeof PrCreatedDataSchema>;

export const ConclusionDataSchema = z.object({
  root_cause: z.string(),
  confidence: ConfidenceSchema,
  decision: DecisionSchema,
});
export type ConclusionData = z.infer<typeof ConclusionDataSchema>;

export const SessionCompletedDataSchema = z.object({
  status: SessionStatusSchema,
  cost_usd: z.number(),
  iterations: z.number().int(),
});
export type SessionCompletedData = z.infer<typeof SessionCompletedDataSchema>;

export const FeedErrorDataSchema = z.object({ message: z.string() });
export type FeedErrorData = z.infer<typeof FeedErrorDataSchema>;

/** Sent first to late subscribers: the persisted steps so far (SPEC §7.3). */
export const ReplayDataSchema = z.object({ steps: z.array(StepSchema) });
export type ReplayData = z.infer<typeof ReplayDataSchema>;

export const FeedEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('replay'), data: ReplayDataSchema }),
  z.object({ event: z.literal('session_started'), data: SessionStartedDataSchema }),
  z.object({ event: z.literal('step'), data: StepSchema }),
  z.object({ event: z.literal('pr_created'), data: PrCreatedDataSchema }),
  z.object({ event: z.literal('conclusion'), data: ConclusionDataSchema }),
  z.object({ event: z.literal('session_completed'), data: SessionCompletedDataSchema }),
  z.object({ event: z.literal('error'), data: FeedErrorDataSchema }),
  HeartbeatEventSchema,
]);
export type FeedEvent = z.infer<typeof FeedEventSchema>;

/* ── Chat stream: GET /incidents/:id/chat/stream (SPEC §7.4) ─────────────── */

export const ChatStreamEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('token'), data: z.object({ text: z.string() }) }),
  z.object({ event: z.literal('done'), data: z.object({ content: z.string() }) }),
  HeartbeatEventSchema,
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

/* ── Performance stream: performance ticker feed (AI Incident PREVENTION) ── */

/**
 * Shared payload for every performance-stream frame. `service` + `endpoint`
 * name the endpoint; `status` is its current `RiskStatus` (NORMAL … BREACHED);
 * `riskScore` is the 0-100 roll-up; `minutesToBreach` (null when not trending)
 * and `probability` (0-1) carry the breach prediction when one exists.
 */
export const PerformanceEventDataSchema = z.object({
  service: z.string(),
  endpoint: z.string(),
  status: z.string(),
  riskScore: z.number(),
  minutesToBreach: z.number().nullish(),
  probability: z.number().optional(),
});
export type PerformanceEventData = z.infer<typeof PerformanceEventDataSchema>;

/** Emitted per processed endpoint each aggregation window. */
export const PerformanceTickEventSchema = z.object({
  event: z.literal('performance_tick'),
  data: PerformanceEventDataSchema,
});
export type PerformanceTickEvent = z.infer<typeof PerformanceTickEventSchema>;

/** Emitted when an endpoint escalates into the early-warning band (EARLY_RISK / WARNING). */
export const EarlyWarningAlertEventSchema = z.object({
  event: z.literal('early_warning_alert'),
  data: PerformanceEventDataSchema,
});
export type EarlyWarningAlertEvent = z.infer<typeof EarlyWarningAlertEventSchema>;

/** Emitted when an endpoint escalates into the high-severity band (ESCALATED / BREACHED). */
export const RiskEscalationEventSchema = z.object({
  event: z.literal('risk_escalation'),
  data: PerformanceEventDataSchema,
});
export type RiskEscalationEvent = z.infer<typeof RiskEscalationEventSchema>;

/* ── Host early-warning stream: HOST resource prediction (CPU/Mem/DB-pool) ── */

/**
 * Shared payload for every host early-warning frame. `service` + `metric` name
 * the tracked resource (`metric` is a `HostMetricName`: cpu | mem | db_pool);
 * `status` is its durable `RiskStatus`; `current` is the latest reading and
 * `threshold` the SLO it climbs toward; `probability` (0-1) + `minutesToBreach`
 * (null when not trending) carry the prediction; `likelyCause` +
 * `recommendedAction` are the operator guidance the AI EARLY WARNING card shows.
 */
export const HostEarlyWarningEventDataSchema = z.object({
  service: z.string(),
  metric: z.string(),
  status: z.string(),
  current: z.number(),
  threshold: z.number(),
  probability: z.number().optional(),
  minutesToBreach: z.number().nullish(),
  likelyCause: z.string(),
  recommendedAction: z.string(),
});
export type HostEarlyWarningEventData = z.infer<
  typeof HostEarlyWarningEventDataSchema
>;

/** Emitted per host metric each host-ticker window (and on escalation). */
export const HostEarlyWarningEventSchema = z.object({
  event: z.literal('host_early_warning'),
  data: HostEarlyWarningEventDataSchema,
});
export type HostEarlyWarningEvent = z.infer<typeof HostEarlyWarningEventSchema>;

/* ── Escalation ladder + recovery: the "ESCALATE IF IGNORED" stream ────────── */

/**
 * Emitted once per channel send as an alert climbs the escalation ladder
 * (Dashboard → Email → CRITICAL). `alertId` ties the frame to its `Alert`;
 * `step` is the ladder rung (`EARLY_RISK` | `WARNING` | `CRITICAL`), `channel`
 * the delivery adapter (`dashboard` | `email` | …), `message` the rendered body,
 * and `acknowledged` reflects whether the alert has been acked (escalation
 * stops once true). `source` is `host` | `api`; `metric` names the resource
 * (cpu | mem | db_pool) or endpoint.
 */
export const EscalationNoticeEventDataSchema = z.object({
  alertId: z.string(),
  source: z.string(),
  service: z.string(),
  metric: z.string(),
  step: z.string(),
  channel: z.string(),
  status: z.string(),
  message: z.string(),
  acknowledged: z.boolean(),
  at: z.number(),
});
export type EscalationNoticeEventData = z.infer<
  typeof EscalationNoticeEventDataSchema
>;

export const EscalationNoticeEventSchema = z.object({
  event: z.literal('escalation_notice'),
  data: EscalationNoticeEventDataSchema,
});
export type EscalationNoticeEvent = z.infer<typeof EscalationNoticeEventSchema>;

/** Emitted when an alert returns to normal — the RECOVERY all-clear. */
export const RecoveryNoticeEventDataSchema = z.object({
  alertId: z.string(),
  source: z.string(),
  service: z.string(),
  metric: z.string(),
  message: z.string(),
  at: z.number(),
});
export type RecoveryNoticeEventData = z.infer<
  typeof RecoveryNoticeEventDataSchema
>;

export const RecoveryNoticeEventSchema = z.object({
  event: z.literal('recovery_notice'),
  data: RecoveryNoticeEventDataSchema,
});
export type RecoveryNoticeEvent = z.infer<typeof RecoveryNoticeEventSchema>;

export const PerformanceStreamEventSchema = z.discriminatedUnion('event', [
  PerformanceTickEventSchema,
  EarlyWarningAlertEventSchema,
  RiskEscalationEventSchema,
  HostEarlyWarningEventSchema,
  EscalationNoticeEventSchema,
  RecoveryNoticeEventSchema,
  HeartbeatEventSchema,
]);
export type PerformanceStreamEvent = z.infer<typeof PerformanceStreamEventSchema>;

/** All SSE event names used across the platform. */
export const SSE_EVENT_NAMES = [
  'log',
  'heartbeat',
  'replay',
  'session_started',
  'step',
  'pr_created',
  'conclusion',
  'session_completed',
  'error',
  'token',
  'done',
  'performance_tick',
  'early_warning_alert',
  'risk_escalation',
  'host_early_warning',
  'escalation_notice',
  'recovery_notice',
] as const;
export type SseEventName = (typeof SSE_EVENT_NAMES)[number];
