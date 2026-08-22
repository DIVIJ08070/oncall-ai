import type { EndpointPerformance, RiskStatus, PerformanceGrade } from '@oncall/shared';

/**
 * Shared presentation model for the AI PREVENTION deep-dive cards
 * (PerformanceScoreCard + TrendPredictionCard). Mirrors the color/ranking logic
 * the EarlyWarningCard list uses, extracted here so the gauge + forecast cards
 * stay in lock-step with the list without importing from a sibling component.
 */

export const GREEN = '#52D273';
export const ORANGE = '#FF8233';
export const AMBER = '#F5A623';
export const RED = '#FF3B30';
export const ESCALATE = '#FF6B3D';

/** Prediction lifecycle states that count as "trending toward a breach". */
export const WARNING_STATUSES: ReadonlySet<RiskStatus> = new Set<RiskStatus>([
  'EARLY_RISK',
  'WARNING',
  'ESCALATED',
  'BREACHED',
]);

/** Ordering weight so the worst risk climbs to the top. */
export const RISK_RANK: Record<RiskStatus, number> = {
  BREACHED: 5,
  ESCALATED: 4,
  WARNING: 3,
  EARLY_RISK: 2,
  RECOVERED: 1,
  NORMAL: 0,
};

export const STATUS_COLOR: Record<RiskStatus, string> = {
  EARLY_RISK: AMBER,
  WARNING: ORANGE,
  ESCALATED: ESCALATE,
  BREACHED: RED,
  RECOVERED: GREEN,
  NORMAL: GREEN,
};

export const STATUS_LABEL: Record<RiskStatus, string> = {
  EARLY_RISK: 'early risk',
  WARNING: 'warning',
  ESCALATED: 'escalating',
  BREACHED: 'breached',
  RECOVERED: 'recovering',
  NORMAL: 'stable',
};

const GRADE_LABEL: Record<PerformanceGrade, string> = {
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  DEGRADED: 'Degraded',
  CRITICAL: 'Critical',
};

export function gradeLabel(grade: PerformanceGrade): string {
  return GRADE_LABEL[grade];
}

/** 4-band meter/grade color keyed to the 0-100 score. */
export function scoreColor(score: number): string {
  if (score >= 85) return GREEN;
  if (score >= 70) return ORANGE;
  if (score >= 50) return AMBER;
  return RED;
}

/** An endpoint is healthy when it scores well AND nothing is trending to breach. */
export function isHealthy(e: EndpointPerformance): boolean {
  return e.score.overall_score >= 85 && !WARNING_STATUSES.has(e.prediction.status);
}

/** Stable identity for one endpoint row (service + method + path). */
export function endpointKey(e: EndpointPerformance): string {
  return `${e.service} ${e.method} ${e.endpoint}`;
}

/** The bold forecast line — a breach ETA for warnings, else a stable read-out. */
export function predictionLine(e: EndpointPerformance): string {
  const p = e.prediction;
  const prob = Math.round(p.probability * 100);
  if (p.status === 'BREACHED') return `SLO breached now · ${prob}%`;
  if (WARNING_STATUSES.has(p.status) && p.minutesToBreach != null) {
    return `may breach in ~${Math.max(1, Math.round(p.minutesToBreach))} min · ${prob}%`;
  }
  return `${STATUS_LABEL[p.status]} · ${prob}% breach risk`;
}

/** Worst risk first: by status rank, then lowest score, then highest probability. */
export function byRisk(a: EndpointPerformance, b: EndpointPerformance): number {
  const rank = RISK_RANK[b.prediction.status] - RISK_RANK[a.prediction.status];
  if (rank !== 0) return rank;
  const score = a.score.overall_score - b.score.overall_score;
  if (score !== 0) return score;
  return b.prediction.probability - a.prediction.probability;
}

/**
 * The single endpoint to deep-dive: the most at-risk one (worst status, then
 * lowest score). With only healthy endpoints this surfaces the weakest link, so
 * the gauge always has a meaningful subject. Endpoints with too little traffic to
 * score (very low request counts) are de-prioritised so the deep dive lands on a
 * real signal, not a cold-start window.
 */
export function focusEndpoint(
  endpoints: readonly EndpointPerformance[],
): EndpointPerformance | null {
  if (endpoints.length === 0) return null;
  const ranked = [...endpoints].sort(byRisk);
  const meaningful = ranked.filter((e) => e.requestCount >= 5);
  return (meaningful[0] ?? ranked[0]) ?? null;
}
