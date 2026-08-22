/**
 * Performance scoring + breach-prediction domain — Phase 1 of AI Incident
 * PREVENTION ("predict before" vs. "fix after"). Pure types only: the math
 * lives in `@oncall/server` (services/performance-score.ts + trend-prediction.ts)
 * and is unit-tested there. Nothing here imports runtime deps.
 */

/** Letter grade derived from a 0-100 endpoint performance score. */
export type PerformanceGrade = 'EXCELLENT' | 'GOOD' | 'DEGRADED' | 'CRITICAL';

/** Lifecycle of a breach prediction as an endpoint drifts toward its SLO. */
export type RiskStatus =
  | 'NORMAL'
  | 'EARLY_RISK'
  | 'WARNING'
  | 'ESCALATED'
  | 'BREACHED'
  | 'RECOVERED';

/**
 * A 0-100 performance score for one endpoint, split into the four weighted
 * sub-scores that produced it (Latency 40 / Error 30 / Availability 20 /
 * Throughput 10). `overall_score` is clamped 0-100 and drives `grade`.
 */
export interface EndpointScoreBreakdown {
  service: string;
  endpoint: string;
  overall_score: number;
  latency_score: number;
  error_score: number;
  availability_score: number;
  throughput_score: number;
  grade: PerformanceGrade;
}

/**
 * A forward-looking breach prediction for one endpoint. `probability` is 0-1,
 * `minutesToBreach` is null when the endpoint is not trending toward a breach,
 * and `riskScore` is a 0-100 convenience roll-up of the prediction on its own.
 */
export interface RiskPrediction {
  status: RiskStatus;
  probability: number;
  minutesToBreach: number | null;
  riskScore: number;
  detail: string;
}

/**
 * The full per-endpoint performance record emitted each rollup window — the
 * window's aggregate metrics plus the computed score breakdown and prediction.
 */
export interface EndpointPerformance {
  service: string;
  endpoint: string;
  method: string;
  windowStart: number;
  windowEnd: number;
  requestCount: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  timeoutRate: number;
  score: EndpointScoreBreakdown;
  prediction: RiskPrediction;
}
