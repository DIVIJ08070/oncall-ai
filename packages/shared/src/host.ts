import type { RiskPrediction, RiskStatus } from './performance.js';

/**
 * Host-level early-warning domain (AI Incident PREVENTION — HOST layer).
 *
 * Where `performance.ts` predicts per-endpoint SLO breaches from request
 * telemetry, this layer predicts host RESOURCE exhaustion (CPU / Memory /
 * DB-pool) from `host_metric_samples`, reusing the same {@link RiskPrediction}
 * trend engine. Each tracked (service, metric) carries its current reading, its
 * trailing baseline, the SLO threshold it is climbing toward, the breach
 * prediction, and a human-facing `likelyCause` + `recommendedAction` — the
 * "increase connection pool 100→150" style guidance the dashboard's AI EARLY
 * WARNING card renders. Pure types only; the math lives in `@oncall/server`.
 */

/** The three host resource metrics tracked + predicted independently. */
export type HostMetricName = 'cpu' | 'mem' | 'db_pool';

/** All host metric names, in display order (CPU → Memory → DB-pool). */
export const HOST_METRIC_NAMES: readonly HostMetricName[] = [
  'cpu',
  'mem',
  'db_pool',
];

/**
 * A forward-looking risk assessment for one (service, metric): the latest
 * reading, the trailing baseline it is measured against, the threshold it must
 * not cross, the reused breach {@link RiskPrediction}, the durable
 * flap-protected {@link RiskStatus}, and the operator guidance.
 */
export interface HostRisk {
  service: string;
  metric: HostMetricName;
  /** Latest observed value (0-100 for cpu/mem/db_pool). */
  current: number;
  /** Trailing-normal value the trend is measured against. */
  baseline: number;
  /** SLO threshold the metric must not cross (from config). */
  threshold: number;
  /** Reused trend/breach prediction (probability, minutesToBreach, status). */
  prediction: RiskPrediction;
  /** Durable, flap-protected escalation status (from `risk_states`). */
  status: RiskStatus;
  /** Human-facing probable cause, e.g. "connection pool near capacity". */
  likelyCause: string;
  /** Suggested fix, e.g. "Increase connection pool (e.g. 100→150)". */
  recommendedAction: string;
}

/**
 * One metric row in the `GET /api/v1/host-early-warning` response — the flat DTO
 * the AI EARLY WARNING card renders: a `bars` fill (0-100), the durable status,
 * the breach probability + ETA, and a short `series` for the sparkline.
 */
export interface HostEarlyWarningMetric {
  service: string;
  metric: HostMetricName;
  /** Latest reading (0-100 for cpu/mem/db_pool). */
  current: number;
  /** Bar fill 0-100 (clamped `current`) for the metric gauge. */
  bars: number;
  /** Durable flap-protected escalation status. */
  status: RiskStatus;
  /** Breach probability 0-1. */
  probability: number;
  /** Estimated minutes until the threshold is crossed (null when not trending). */
  minutesToBreach: number | null;
  /** SLO threshold the metric is climbing toward. */
  threshold: number;
  likelyCause: string;
  recommendedAction: string;
  /** Recent readings oldest→newest for the sparkline. */
  series: number[];
}

/** The `GET /api/v1/host-early-warning` response body. */
export interface HostEarlyWarningResponse {
  metrics: HostEarlyWarningMetric[];
  generatedAt: number;
}
