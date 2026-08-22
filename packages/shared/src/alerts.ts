import type { RiskStatus } from './performance.js';

/**
 * Escalation + recovery domain (AI Incident PREVENTION — the "ESCALATE IF
 * IGNORED" ladder). Where `host.ts` / `performance.ts` describe the *prediction*,
 * this layer describes what happens once a predicted risk is real and left
 * unhandled: an alert climbs a channel ladder (Dashboard → Email → …) and — only
 * when nobody ACKNOWLEDGES within the grace window — escalates to CRITICAL, then
 * clears with a RECOVERY notice when the metric returns to normal.
 *
 * Pure types only; the policy engine + channel adapters live in `@oncall/server`
 * (`services/escalation/`).
 */

/** Which ticker raised the alert: the HOST resource layer or the API layer. */
export type AlertSource = 'host' | 'api';

/**
 * The ladder rungs an alert climbs. `EARLY_RISK` and `WARNING` are reached from
 * the durable risk status; `CRITICAL` is reached ONLY when a `WARNING` goes
 * unacknowledged past the grace window (the "escalate if ignored" rung).
 */
export type AlertStep = 'EARLY_RISK' | 'WARNING' | 'CRITICAL';

/**
 * The kind of one escalation event — a ladder rung, or the `RECOVERY` all-clear
 * fired when the alert returns to normal.
 */
export type EscalationStepKind = AlertStep | 'RECOVERY';

/**
 * Delivery channels. Only `dashboard` + `email` are wired; `sms` + `whatsapp`
 * are present-but-disabled stubs (flip them on in the ladder config + registry
 * when real creds exist).
 */
export type EscalationChannel = 'dashboard' | 'email' | 'sms' | 'whatsapp';

/**
 * Delivery status of one channel send. Channels are SIMULATED, so an enabled
 * channel records `sent`; a disabled stub that is nonetheless invoked records
 * `stubbed`; `skipped` marks a channel filtered out of the ladder; `failed`
 * marks a best-effort webhook POST that errored.
 */
export type EscalationStatus = 'sent' | 'stubbed' | 'skipped' | 'failed';

/**
 * One fired notification in an alert's escalation timeline (a persisted
 * `alert_notifications` row) — which rung, which channel, the rendered message,
 * and when it went out.
 */
export interface EscalationStep {
  id: string;
  step: EscalationStepKind;
  channel: EscalationChannel;
  status: EscalationStatus;
  /** Rendered, human-readable message body the timeline shows. */
  message: string;
  /** Epoch ms the send was recorded. */
  at: number;
}

/**
 * A durable early-warning alert: one active escalation slot per risky
 * (service, metric/endpoint). Carries the live prediction snapshot, the highest
 * ladder rung reached, and the acknowledgement state that stops further
 * escalation.
 */
export interface Alert {
  id: string;
  source: AlertSource;
  service: string;
  /** `cpu` | `mem` | `db_pool` for host alerts; the endpoint path for api alerts. */
  metric: string;
  title: string;
  /** Durable, flap-protected risk status (from `risk_states`). */
  status: RiskStatus;
  /** Highest ladder rung reached so far (null before the first escalation). */
  step: AlertStep | null;
  /** Latest observed value (%, or p95 ms for api alerts). */
  current: number | null;
  /** SLO threshold the metric is climbing toward. */
  threshold: number | null;
  /** Breach probability 0-1. */
  probability: number | null;
  /** Estimated minutes until breach (null when not trending). */
  minutesToBreach: number | null;
  likelyCause: string | null;
  recommendedAction: string | null;
  /** `true` once acknowledged — stops further escalation. */
  acknowledged: boolean;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  firstDetectedAt: number;
  lastEscalatedAt: number | null;
  /** Set once the alert returns to normal (RECOVERY fired). */
  resolvedAt: number | null;
  /** `true` while still elevated (not yet recovered). */
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/** An alert plus its ordered escalation timeline — one `GET /alerts` row. */
export interface AlertTimeline extends Alert {
  timeline: EscalationStep[];
}

/** The `GET /api/v1/alerts` response body. */
export interface AlertsResponse {
  alerts: AlertTimeline[];
  generatedAt: number;
}

/** The `POST /api/v1/alerts/:id/ack` response body. */
export interface AckAlertResponse {
  alert: AlertTimeline;
}
