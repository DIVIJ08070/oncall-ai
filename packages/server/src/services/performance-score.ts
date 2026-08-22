import type { EndpointScoreBreakdown, PerformanceGrade } from '@oncall/shared';

/**
 * Endpoint performance scoring — Phase 1 of AI Incident PREVENTION.
 *
 * A 0-100 score per endpoint, composed of four weighted sub-scores:
 *   - Latency      (40)  p95 vs. baseline p95
 *   - Error        (30)  error rate
 *   - Availability (20)  timeout rate
 *   - Throughput   (10)  traffic stability vs. baseline rps
 *
 * NOTE ON THE SPEC BUG: the team spec hardcoded the throughput sub-score at a
 * flat 10, which makes it dead weight. We instead compute it from traffic
 * stability: full 10 while volume stays inside a stable band of baseline, then
 * decaying toward 0 as the relative deviation grows. Callers with no baseline
 * rps get the full 10 (behaviour-preserving), so nothing regresses.
 */

/** Default baseline p95 (ms) used when a caller has no measured baseline. */
const DEFAULT_BASELINE_P95_MS = 150;

/** Sub-score ceilings (the SPEC weights). */
const LATENCY_WEIGHT = 40;
const ERROR_WEIGHT = 30;
const AVAILABILITY_WEIGHT = 20;
const THROUGHPUT_WEIGHT = 10;

/**
 * Relative rps deviation (|rps - baselineRps| / max(baselineRps, 1)) that is
 * treated as "stable" and incurs no throughput penalty.
 */
const THROUGHPUT_STABLE_BAND = 0.2;

/**
 * Deviation past the stable band at which the throughput penalty reaches its
 * cap (the full weight). At `STABLE_BAND + THROUGHPUT_PENALTY_SPAN` deviation
 * the throughput sub-score bottoms out at 0.
 */
const THROUGHPUT_PENALTY_SPAN = 0.8;

export interface EndpointScoreOptions {
  /** Endpoint identity, echoed into the breakdown. */
  service?: string;
  endpoint?: string;
  /** Current request rate for this window (requests/sec). */
  rps?: number;
  /** Trailing baseline request rate (requests/sec). */
  baselineRps?: number;
}

/** Clamp `n` into the inclusive `[lo, hi]` range. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Round to a whole number, guarding against `-0` / NaN leaking through. */
function whole(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n);
  return r === 0 ? 0 : r; // normalise -0 -> 0
}

/**
 * Throughput sub-score (0-10) from traffic stability. Full marks while the
 * relative rps deviation stays within the stable band; then decays linearly to
 * 0. With no usable baseline/current pair we return the full weight so callers
 * without a throughput baseline are unaffected.
 */
function throughputScoreFor(rps?: number, baselineRps?: number): number {
  if (
    rps == null ||
    baselineRps == null ||
    !Number.isFinite(rps) ||
    !Number.isFinite(baselineRps)
  ) {
    return THROUGHPUT_WEIGHT;
  }
  const deviation = Math.abs(rps - baselineRps) / Math.max(baselineRps, 1);
  const overBand = Math.max(0, deviation - THROUGHPUT_STABLE_BAND);
  // Penalty scales across the span and is capped at the full weight.
  const penalty = clamp(
    (overBand / THROUGHPUT_PENALTY_SPAN) * THROUGHPUT_WEIGHT,
    0,
    THROUGHPUT_WEIGHT,
  );
  return THROUGHPUT_WEIGHT - penalty;
}

/** Map a clamped 0-100 overall score to its letter grade. */
export function gradeFor(overall: number): PerformanceGrade {
  if (overall < 50) return 'CRITICAL';
  if (overall < 70) return 'DEGRADED';
  if (overall < 85) return 'GOOD';
  return 'EXCELLENT';
}

/**
 * Compute the weighted 0-100 performance score for a single endpoint window.
 *
 * @param p95LatencyMs  Observed p95 latency for the window (ms).
 * @param baselineP95Ms Trailing baseline p95 (ms); falsy -> DEFAULT_BASELINE_P95_MS.
 * @param errorRate     Error rate as a fraction (0-1).
 * @param timeoutRate   Timeout rate as a fraction (0-1).
 * @param opts          Optional identity + throughput-stability inputs.
 */
export function calculateEndpointScore(
  p95LatencyMs: number,
  baselineP95Ms: number,
  errorRate: number,
  timeoutRate: number,
  opts: EndpointScoreOptions = {},
): EndpointScoreBreakdown {
  const baselineP95 = baselineP95Ms || DEFAULT_BASELINE_P95_MS;

  // Latency (40): every 100% over baseline p95 costs 20 points.
  const latencyRatio = Math.max(1, p95LatencyMs / baselineP95);
  const latency_score = clamp(
    LATENCY_WEIGHT - (latencyRatio - 1) * 20,
    0,
    LATENCY_WEIGHT,
  );

  // Error (30): each 1% error rate costs 3 points.
  const error_score = clamp(
    ERROR_WEIGHT - errorRate * 300,
    0,
    ERROR_WEIGHT,
  );

  // Availability (20): each 1% timeout rate costs 2 points.
  const availability_score = clamp(
    AVAILABILITY_WEIGHT - timeoutRate * 200,
    0,
    AVAILABILITY_WEIGHT,
  );

  // Throughput (10): traffic-stability (see throughputScoreFor).
  const throughput_score = throughputScoreFor(opts.rps, opts.baselineRps);

  const latency = whole(latency_score);
  const error = whole(error_score);
  const availability = whole(availability_score);
  const throughput = whole(throughput_score);
  const overall = clamp(latency + error + availability + throughput, 0, 100);

  return {
    service: opts.service ?? '',
    endpoint: opts.endpoint ?? '',
    overall_score: overall,
    latency_score: latency,
    error_score: error,
    availability_score: availability,
    throughput_score: throughput,
    grade: gradeFor(overall),
  };
}
