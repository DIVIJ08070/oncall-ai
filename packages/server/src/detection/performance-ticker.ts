import type {
  EndpointPerformance,
  PerformanceEventData,
  RiskPrediction,
  RiskStatus,
} from '@oncall/shared';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';
import type { ApiRequestEndpoint } from '../db/dao/types.js';
import type { ApiPerformanceSampleRow } from '../db/rows.js';
import type { Broker } from '../sse/broker.js';
import { percentile } from '../metrics/percentile.js';
import { calculateEndpointScore } from '../services/performance-score.js';
import {
  computeRiskScore,
  predictBreach,
  type Point,
} from '../services/trend-prediction.js';
import { type Clock, systemClock } from './clock.js';
import type { DetectionLogger } from './seams.js';
import type { EscalationEngine } from '../services/escalation/policy.js';

/**
 * Performance ticker — Phase 1 of AI Incident PREVENTION ("predict before" vs.
 * "fix after"). Every `PERF_WINDOW_SEC`, per (service, endpoint) seen in the
 * trailing window's `api_request_samples` (the raw per-request telemetry the
 * ingest writer populates), it:
 *
 *   1. rolls the raw samples up into one window profile (request volume, rps,
 *      p50/p95/p99 latency, error rate, timeout rate) — a **single grouped
 *      query** per endpoint (Rule 2) via the `api_request_samples` DAO;
 *   2. derives the endpoint baseline (trailing avg of prior samples), scores the
 *      window 0-100 via {@link calculateEndpointScore}, and predicts a breach
 *      via {@link predictBreach};
 *   3. upserts the `api_performance_samples` row for the window;
 *   4. advances the durable `risk_states` escalation ladder with **dual flap
 *      protection** (Rule 5) — 2 consecutive risk windows to step up, 2 healthy
 *      to step down toward RECOVERED → NORMAL.
 *
 * Guards mirror the detection engine: an `isAggregating` mutex (Rule 3) so ticks
 * never overlap, and `Promise.allSettled` per endpoint (Rule 4) so one bad
 * endpoint can't sink the whole window. Time is read only through an injected
 * `Clock`, so the loop is deterministic under test.
 */

/** Latency (ms) at/above which a request is treated as a timeout (Rule: §avail). */
export const PERF_TIMEOUT_MS = 5_000;

/** Trailing samples pulled for the baseline + trend regression. */
const HISTORY_SAMPLE_LIMIT = 20;

/** SSE topic the ticker publishes a lightweight "updated" ping to. */
export function performanceTopic(): string {
  return 'performance';
}

/* ── flap-protected risk ladder (Rule 5) ─────────────────────────────────── */

/** Prediction statuses that count a window as "at risk" for the flap machine. */
const RISKY_STATUSES: ReadonlySet<RiskStatus> = new Set<RiskStatus>([
  'EARLY_RISK',
  'WARNING',
  'ESCALATED',
  'BREACHED',
]);

/** Consecutive risk windows required to step the persisted status up one level. */
export const ESCALATE_WINDOWS = 2;
/** Consecutive healthy windows required to step the persisted status down. */
export const DEESCALATE_WINDOWS = 2;

/** One rung up the escalation ladder (top rung maps to itself). */
const UP_NEXT: Record<RiskStatus, RiskStatus> = {
  NORMAL: 'EARLY_RISK',
  RECOVERED: 'EARLY_RISK',
  EARLY_RISK: 'WARNING',
  WARNING: 'ESCALATED',
  ESCALATED: 'ESCALATED',
  BREACHED: 'BREACHED',
};

/** One rung down the ladder — elevated states cool through RECOVERED → NORMAL. */
const DOWN_NEXT: Record<RiskStatus, RiskStatus> = {
  BREACHED: 'ESCALATED',
  ESCALATED: 'WARNING',
  WARNING: 'EARLY_RISK',
  EARLY_RISK: 'RECOVERED',
  RECOVERED: 'NORMAL',
  NORMAL: 'NORMAL',
};

const ALL_STATUSES: ReadonlySet<string> = new Set<RiskStatus>([
  'NORMAL',
  'EARLY_RISK',
  'WARNING',
  'ESCALATED',
  'BREACHED',
  'RECOVERED',
]);

/**
 * Severity rank of each status for escalation detection. NORMAL and the cooled
 * RECOVERED both sit at the floor; a window whose durable status climbs to a
 * higher rank is an *escalation* and emits an SSE alert.
 */
const STATUS_RANK: Record<RiskStatus, number> = {
  NORMAL: 0,
  RECOVERED: 0,
  EARLY_RISK: 1,
  WARNING: 2,
  ESCALATED: 3,
  BREACHED: 4,
};

/** Coerce a stored status string back to a known `RiskStatus` (default NORMAL). */
export function normalizeStatus(raw: string | undefined | null): RiskStatus {
  return raw != null && ALL_STATUSES.has(raw) ? (raw as RiskStatus) : 'NORMAL';
}

/** The subset of a `risk_states` row the flap machine reads. */
export interface RiskStatePrev {
  status: string;
  consecutive_risk_windows: number;
  consecutive_healthy_windows: number;
  first_detected_at: number | null;
  last_escalated_at: number | null;
}

/** The flap machine's next state for one endpoint window. */
export interface RiskStep {
  status: RiskStatus;
  consecutiveRisk: number;
  consecutiveHealthy: number;
  firstDetectedAt: number | null;
  lastEscalatedAt: number | null;
}

/**
 * Advance the durable risk state by one window with dual flap protection.
 *
 * A single risky window never escalates on its own — it takes
 * {@link ESCALATE_WINDOWS} in a row to climb one rung, and
 * {@link DEESCALATE_WINDOWS} healthy windows in a row to step back down. An
 * *observed* breach (prediction already BREACHED) jumps straight to BREACHED.
 */
export function stepRiskState(
  prev: RiskStatePrev | null,
  prediction: RiskPrediction,
  now: number,
): RiskStep {
  let status = normalizeStatus(prev?.status);
  let risk = prev?.consecutive_risk_windows ?? 0;
  let healthy = prev?.consecutive_healthy_windows ?? 0;
  let firstDetectedAt = prev?.first_detected_at ?? null;
  let lastEscalatedAt = prev?.last_escalated_at ?? null;

  if (prediction.status === 'BREACHED') {
    // Observed breach: no prediction needed, jump to the top of the ladder.
    risk += 1;
    healthy = 0;
    status = 'BREACHED';
    if (firstDetectedAt === null) firstDetectedAt = now;
    lastEscalatedAt = now;
  } else if (RISKY_STATUSES.has(prediction.status)) {
    risk += 1;
    healthy = 0;
    if (risk >= ESCALATE_WINDOWS && UP_NEXT[status] !== status) {
      status = UP_NEXT[status];
      risk = 0; // reset the streak so the next rung needs its own run
      if (firstDetectedAt === null) firstDetectedAt = now;
      lastEscalatedAt = now;
    }
  } else {
    healthy += 1;
    risk = 0;
    if (healthy >= DEESCALATE_WINDOWS && DOWN_NEXT[status] !== status) {
      status = DOWN_NEXT[status];
      healthy = 0;
      if (status === 'NORMAL') firstDetectedAt = null; // fully cooled down
    }
  }

  return {
    status,
    consecutiveRisk: risk,
    consecutiveHealthy: healthy,
    firstDetectedAt,
    lastEscalatedAt,
  };
}

/* ── window scoring core (shared by the ticker + the read route) ──────────── */

/** Flat per-window metrics — the `EndpointPerformance` fields minus score/pred. */
export interface PerfWindowMetrics {
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
}

/** The scored + predicted result for one window. */
export interface ScoredWindow {
  score: EndpointPerformance['score'];
  prediction: RiskPrediction;
  riskScore: number;
}

/** Inputs that size the prediction (threshold / window minutes / cold-start). */
export interface ScoreContext {
  thresholdMs: number;
  windowMinutes: number;
  minRequests: number;
}

/** The subset of a prior sample the baseline + regression need. */
export interface PriorSample {
  window_start: number;
  p95_latency_ms: number;
  rps: number;
}

function avg(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Score + predict one endpoint window from its metrics and its trailing prior
 * samples (oldest → newest). Deterministic and pure, so the read route can
 * reconstruct the exact same DTO the ticker persisted from the stored rows.
 */
export function scoreWindow(
  m: PerfWindowMetrics,
  priorSamplesOldestFirst: readonly PriorSample[],
  ctx: ScoreContext,
): ScoredWindow {
  // Exclude any prior sample for this same window (a re-run of the same window)
  // so the baseline/regression only ever look strictly backwards.
  const prior = priorSamplesOldestFirst.filter(
    (s) => s.window_start !== m.windowStart,
  );
  const hasBaseline = prior.length > 0;
  const baselineP95 = hasBaseline ? avg(prior.map((s) => s.p95_latency_ms)) : 0;
  const baselineRps = hasBaseline ? avg(prior.map((s) => s.rps)) : undefined;

  const score = calculateEndpointScore(
    m.p95,
    baselineP95,
    m.errorRate,
    m.timeoutRate,
    { service: m.service, endpoint: m.endpoint, rps: m.rps, baselineRps },
  );

  const points: Point[] = [
    ...prior.map((s) => ({ t: s.window_start, value: s.p95_latency_ms })),
    { t: m.windowStart, value: m.p95 },
  ];
  const prediction = predictBreach(points, ctx.thresholdMs, baselineP95, m.p95, {
    windowMinutes: ctx.windowMinutes,
    requestCount: m.requestCount,
    minRequests: ctx.minRequests,
  });

  const riskScore = computeRiskScore(score, prediction);
  return { score, prediction, riskScore };
}

/** Flatten a stored sample row back into the `PerfWindowMetrics` shape. */
export function metricsFromRow(row: ApiPerformanceSampleRow): PerfWindowMetrics {
  return {
    service: row.service_name,
    endpoint: row.endpoint,
    method: row.method,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    requestCount: row.request_count,
    rps: row.rps,
    p50: row.p50_latency_ms,
    p95: row.p95_latency_ms,
    p99: row.p99_latency_ms,
    errorRate: row.error_rate,
    timeoutRate: row.timeout_rate,
  };
}

/** Assemble the wire DTO from flat metrics + the scored result. */
export function toEndpointPerformance(
  m: PerfWindowMetrics,
  scored: ScoredWindow,
): EndpointPerformance {
  return {
    service: m.service,
    endpoint: m.endpoint,
    method: m.method,
    windowStart: m.windowStart,
    windowEnd: m.windowEnd,
    requestCount: m.requestCount,
    rps: m.rps,
    p50: m.p50,
    p95: m.p95,
    p99: m.p99,
    errorRate: m.errorRate,
    timeoutRate: m.timeoutRate,
    score: scored.score,
    prediction: scored.prediction,
  };
}

/* ── the ticker ──────────────────────────────────────────────────────────── */

export interface PerformanceTickerOptions {
  db: OncallDb;
  config: Config;
  broker?: Broker;
  clock?: Clock;
  logger?: DetectionLogger;
  /** Escalation ladder engine (ESCALATE IF IGNORED). Optional — skipped if absent. */
  escalation?: EscalationEngine;
}

/** Per-aggregate summary (returned from `aggregate()` for tests + logging). */
export interface PerfTickResult {
  now: number;
  windowStart: number;
  windowEnd: number;
  endpointsEvaluated: number;
  upserted: number;
  failed: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export class PerformanceTicker {
  private readonly db: OncallDb;
  private readonly config: Config;
  private readonly broker?: Broker;
  private readonly clock: Clock;
  private readonly log: DetectionLogger;
  private readonly escalation?: EscalationEngine;

  private timer?: ReturnType<typeof setInterval>;
  private isAggregating = false; // Rule 3: single-flight mutex

  constructor(opts: PerformanceTickerOptions) {
    this.db = opts.db;
    this.config = opts.config;
    this.broker = opts.broker;
    this.clock = opts.clock ?? systemClock;
    this.log = opts.logger ?? (() => {});
    this.escalation = opts.escalation;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Start the `PERF_WINDOW_SEC` aggregation loop. Idempotent; no-op if disabled. */
  start(): void {
    if (!this.config.performance.enabled) {
      this.log('[performance] ticker disabled (PERF_ENABLED=false)');
      return;
    }
    if (this.timer) return;
    const intervalMs = this.config.performance.windowSec * 1000;
    this.timer = setInterval(() => {
      if (this.isAggregating) return; // Rule 3: never overlap windows
      this.isAggregating = true;
      void this.aggregate()
        .catch((err: unknown) => this.log('[performance] aggregate error', err))
        .finally(() => {
          this.isAggregating = false;
        });
    }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log('[performance] ticker started', {
      windowSec: this.config.performance.windowSec,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.log('[performance] ticker stopped');
    }
  }

  private scoreContext(): ScoreContext {
    return {
      thresholdMs: this.config.detection.latencyP95ThresholdMs,
      windowMinutes: this.config.performance.windowSec / 60,
      minRequests: this.config.detection.minRequestsForDetection,
    };
  }

  /** Run exactly one aggregation window across every active endpoint. */
  async aggregate(): Promise<PerfTickResult> {
    const now = this.clock.now();
    const windowEnd = now;
    const windowStart = now - this.config.performance.windowSec * 1000;
    const ctx = this.scoreContext();

    const endpoints = await this.db.dao.apiRequestSamples.listEndpointsInWindow(
      windowStart,
      windowEnd,
    );
    const settled = await Promise.allSettled(
      endpoints.map((ep) =>
        this.processEndpoint(ep, windowStart, windowEnd, ctx, now),
      ),
    );

    let upserted = 0;
    let failed = 0;
    for (const s of settled) {
      if (s.status === 'fulfilled') upserted++;
      else {
        failed++;
        this.log('[performance] endpoint failed', s.reason);
      }
    }

    if (upserted > 0 && this.broker) {
      this.broker.publish(performanceTopic(), {
        event: 'performance_updated',
        data: { windowStart, windowEnd, endpoints: upserted },
      });
    }

    return {
      now,
      windowStart,
      windowEnd,
      endpointsEvaluated: endpoints.length,
      upserted,
      failed,
    };
  }

  /**
   * Roll one endpoint's trailing window up (single grouped query, Rule 2),
   * score + predict it, persist the sample, and advance the risk state (Rule 4
   * unit). `durations` is aggregated as an array so `percentile()` (the same
   * helper the metric rollups use) can compute p50/p95/p99 in JS.
   */
  private async processEndpoint(
    ep: ApiRequestEndpoint,
    windowStart: number,
    windowEnd: number,
    ctx: ScoreContext,
    now: number,
  ): Promise<void> {
    const agg = await this.db.dao.apiRequestSamples.aggregateWindow(
      ep.service_name,
      ep.endpoint,
      windowStart,
      windowEnd,
      PERF_TIMEOUT_MS,
    );
    const requestCount = agg.count;
    const windowSec = this.config.performance.windowSec;
    const rps = windowSec > 0 ? requestCount / windowSec : 0;
    const denom = Math.max(requestCount, 1);

    const m: PerfWindowMetrics = {
      service: ep.service_name,
      endpoint: ep.endpoint,
      method: ep.method && ep.method.length > 0 ? ep.method : 'GET',
      windowStart,
      windowEnd,
      requestCount,
      rps,
      p50: percentile(agg.durations, 50),
      p95: percentile(agg.durations, 95),
      p99: percentile(agg.durations, 99),
      errorRate: clamp01(agg.errorCount / denom),
      timeoutRate: clamp01(agg.timeoutCount / denom),
    };

    const priorRows = await this.db.dao.apiPerformance.listRecentForEndpoint(
      m.service,
      m.endpoint,
      HISTORY_SAMPLE_LIMIT,
    );
    const oldestFirst = [...priorRows].reverse();
    const scored = scoreWindow(m, oldestFirst, ctx);

    await this.db.dao.apiPerformance.upsertWindow({
      service_name: m.service,
      endpoint: m.endpoint,
      method: m.method,
      window_start: windowStart,
      window_end: windowEnd,
      request_count: requestCount,
      rps,
      p50_latency_ms: m.p50,
      p95_latency_ms: m.p95,
      p99_latency_ms: m.p99,
      error_rate: m.errorRate,
      timeout_rate: m.timeoutRate,
      performance_score: scored.score.overall_score,
      risk_score: scored.riskScore,
      prediction: scored.prediction.detail,
    });

    await this.advanceRiskState(m, scored, now);
  }

  /** Persist the flap-protected next risk state for one endpoint, then stream it. */
  private async advanceRiskState(
    m: PerfWindowMetrics,
    scored: ScoredWindow,
    now: number,
  ): Promise<void> {
    const prev = await this.db.dao.riskStates.get(m.service, m.endpoint);
    const next = stepRiskState(prev, scored.prediction, now);
    await this.db.dao.riskStates.upsert({
      service_name: m.service,
      endpoint: m.endpoint,
      status: next.status,
      first_detected_at: next.firstDetectedAt,
      last_escalated_at: next.lastEscalatedAt,
      consecutive_risk_windows: next.consecutiveRisk,
      consecutive_healthy_windows: next.consecutiveHealthy,
      current_risk_score: scored.riskScore,
      prediction_details: JSON.stringify(scored.prediction),
      updated_at: now,
    });
    const prevStatus = normalizeStatus(prev?.status);
    this.publishRiskEvents(m, scored, prevStatus, next.status);

    // ESCALATE IF IGNORED — advance the escalation ladder for this endpoint.
    if (this.escalation) {
      await this.escalation.onRiskUpdate({
        source: 'api',
        service: m.service,
        metric: m.endpoint,
        riskService: m.service,
        riskEndpoint: m.endpoint,
        prevStatus,
        status: next.status,
        current: m.p95,
        threshold: this.config.detection.latencyP95ThresholdMs,
        probability: scored.prediction.probability,
        minutesToBreach: scored.prediction.minutesToBreach,
        likelyCause: scored.prediction.detail,
        recommendedAction:
          'Investigate the slow path — scale out, add caching, or optimize the query',
        title: `${m.service} ${m.endpoint} latency risk`,
        now,
      });
    }
  }

  /**
   * Stream the per-endpoint SSE frames for this window (broker seam): a
   * `performance_tick` for every processed endpoint, plus — when the durable
   * risk state just stepped *up* a rung — an `early_warning_alert` (into
   * EARLY_RISK / WARNING) or a `risk_escalation` (into ESCALATED / BREACHED).
   * A single window steps at most one rung, so at most one alert fires.
   */
  private publishRiskEvents(
    m: PerfWindowMetrics,
    scored: ScoredWindow,
    prevStatus: RiskStatus,
    nextStatus: RiskStatus,
  ): void {
    if (!this.broker) return;
    const data: PerformanceEventData = {
      service: m.service,
      endpoint: m.endpoint,
      status: nextStatus,
      riskScore: scored.riskScore,
      minutesToBreach: scored.prediction.minutesToBreach,
      probability: scored.prediction.probability,
    };
    this.broker.publish(performanceTopic(), { event: 'performance_tick', data });

    if (STATUS_RANK[nextStatus] > STATUS_RANK[prevStatus]) {
      if (nextStatus === 'EARLY_RISK' || nextStatus === 'WARNING') {
        this.broker.publish(performanceTopic(), {
          event: 'early_warning_alert',
          data,
        });
      } else if (nextStatus === 'ESCALATED' || nextStatus === 'BREACHED') {
        this.broker.publish(performanceTopic(), {
          event: 'risk_escalation',
          data,
        });
      }
    }
  }
}

/** Factory mirroring the detection-engine convention. */
export function createPerformanceTicker(
  opts: PerformanceTickerOptions,
): PerformanceTicker {
  return new PerformanceTicker(opts);
}
