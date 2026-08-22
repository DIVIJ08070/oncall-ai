import type { EndpointScoreBreakdown, RiskPrediction, RiskStatus } from '@oncall/shared';

/**
 * Breach prediction — Phase 1 of AI Incident PREVENTION.
 *
 * Fits an OLS linear regression over the recent window of a metric (e.g. p95
 * latency or error rate) and projects how many windows — hence minutes — until
 * it crosses `threshold`. Produces a {@link RiskPrediction} with a lifecycle
 * status, a 0-1 probability, and an estimated minutes-to-breach.
 *
 * The guards below are numbered to match the team spec so reviewers can map
 * each branch back to the requirement.
 */

/** Rule 9: minimum consecutive windows before we trust a trend at all. */
export const MIN_CONSECUTIVE_WINDOWS = 3;

/** Default wall-clock minutes represented by one rollup window. */
const DEFAULT_WINDOW_MINUTES = 5;

/** Horizon (minutes) over which imminence saturates to 1. */
const IMMINENCE_HORIZON_MIN = 30;

export interface Point {
  /** Timestamp/ordinal of the sample (used only for ordering). */
  t: number;
  /** Metric value at this sample. */
  value: number;
}

export interface PredictBreachOptions {
  /** Minutes per rollup window (converts window-count to minutes). */
  windowMinutes?: number;
  /** Requests observed in the current window (cold-start gate). */
  requestCount?: number;
  /** Minimum requests required before a trend is trusted (cold-start gate). */
  minRequests?: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** OLS slope of `value` against ordinal window index (0,1,2,…). */
function olsSlopePerWindow(points: Point[]): number {
  const n = points.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const y = points[i]!.value;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function coldStart(detail: string): RiskPrediction {
  return {
    status: 'NORMAL',
    probability: 0.05,
    minutesToBreach: null,
    riskScore: 0,
    detail,
  };
}

/**
 * Predict whether/when a metric will breach `threshold`.
 *
 * @param points       Recent samples, oldest → newest.
 * @param threshold    SLO threshold the metric must not cross.
 * @param baseline     Trailing-normal value of the metric.
 * @param currentValue Latest observed value.
 * @param opts         Window sizing + cold-start gates.
 */
export function predictBreach(
  points: Point[],
  threshold: number,
  baseline: number,
  currentValue: number,
  opts: PredictBreachOptions = {},
): RiskPrediction {
  const windowMinutes = opts.windowMinutes ?? DEFAULT_WINDOW_MINUTES;

  // Rule 6: already breached — short-circuit, nothing to predict.
  if (currentValue >= threshold) {
    return {
      status: 'BREACHED',
      probability: 0.99,
      minutesToBreach: 0,
      riskScore: 100,
      detail: `Threshold already breached (${currentValue} ≥ ${threshold}).`,
    };
  }

  // Rule 9: cold-start floor — too few windows, or not enough traffic, to trust.
  if (points.length < MIN_CONSECUTIVE_WINDOWS) {
    return coldStart(
      `Insufficient history (${points.length}/${MIN_CONSECUTIVE_WINDOWS} windows) — holding at NORMAL.`,
    );
  }
  if (
    opts.minRequests != null &&
    opts.requestCount != null &&
    opts.requestCount < opts.minRequests
  ) {
    return coldStart(
      `Low traffic (${opts.requestCount}/${opts.minRequests} requests) — trend not yet reliable.`,
    );
  }

  const slope = olsSlopePerWindow(points);

  // Rule 7: epsilon-guarded headroom denominator (never divide by zero even
  // when baseline == threshold).
  const headroom = Math.max(0.001, threshold - baseline);

  // Rule 8: slope relative to baseline, floored denom and capped magnitude.
  const relativeSlope = Math.min(5, slope / Math.max(0.01, baseline));

  // Proximity: how far currentValue has climbed across the baseline→threshold
  // gap (0 at baseline, 1 at threshold). Clamped, so the epsilon guard cannot
  // produce a NaN or an out-of-range value.
  const proximity = clamp((currentValue - baseline) / headroom, 0, 1);

  const rising = slope > 0;

  // minutesToBreach: windows-to-cross × minutes-per-window, only when rising.
  let minutesToBreach: number | null = null;
  if (rising) {
    const windowsToBreach = (threshold - currentValue) / slope;
    minutesToBreach = Math.max(0, Math.round(windowsToBreach * windowMinutes * 10) / 10);
  }

  // Imminence (0-1): closer breach ⇒ higher. 0 when not rising.
  const imminence =
    minutesToBreach == null ? 0 : clamp(1 - minutesToBreach / IMMINENCE_HORIZON_MIN, 0, 1);

  // Slope strength (0-1): a rise of ~50% of baseline per window saturates.
  const slopeStrength = rising ? clamp(relativeSlope * 2, 0, 1) : 0;

  // Probability blends how close we already are, how hard we're climbing, and
  // how soon the projection lands.
  const probability = clamp(
    0.4 * proximity + 0.35 * slopeStrength + 0.25 * imminence,
    0,
    0.98,
  );

  const status = classify(rising, slope, proximity, probability);
  const riskScore = Math.round(probability * 100);

  return {
    status,
    probability,
    minutesToBreach,
    riskScore,
    detail: describe(status, minutesToBreach, probability),
  };
}

function classify(
  rising: boolean,
  slope: number,
  proximity: number,
  probability: number,
): RiskStatus {
  if (!rising) {
    // Falling from an elevated level reads as a recovery; otherwise all-clear.
    if (slope < 0 && proximity >= 0.4) return 'RECOVERED';
    return 'NORMAL';
  }
  if (probability >= 0.8 || proximity >= 0.9) return 'ESCALATED';
  if (probability >= 0.5 || proximity >= 0.65) return 'WARNING';
  if (probability >= 0.2) return 'EARLY_RISK';
  return 'NORMAL';
}

function describe(
  status: RiskStatus,
  minutesToBreach: number | null,
  probability: number,
): string {
  const pct = Math.round(probability * 100);
  switch (status) {
    case 'ESCALATED':
    case 'WARNING':
    case 'EARLY_RISK':
      return minutesToBreach == null
        ? `Trending up (${pct}% breach probability).`
        : `May breach in ~${minutesToBreach} min (${pct}% probability).`;
    case 'RECOVERED':
      return 'Elevated but trending back toward baseline.';
    default:
      return 'Within normal range.';
  }
}

/**
 * Blend an endpoint's performance score with its breach prediction into a
 * single 0-100 risk score (higher = more at risk). Half comes from the current
 * performance deficit, half from the forward-looking prediction.
 */
export function computeRiskScore(
  score: EndpointScoreBreakdown,
  prediction: RiskPrediction,
): number {
  if (prediction.status === 'BREACHED') return 100;
  const performanceDeficit = clamp(100 - score.overall_score, 0, 100);
  const predictionRisk = clamp(prediction.probability * 100, 0, 100);
  return Math.round(clamp(0.5 * performanceDeficit + 0.5 * predictionRisk, 0, 100));
}
