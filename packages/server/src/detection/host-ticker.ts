import os from 'node:os';
import type { HostMetricName, RiskPrediction, RiskStatus } from '@oncall/shared';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';
import type {
  CreateHostMetricSampleInput,
  HostMetricColumn,
  HostMetricPoint,
} from '../db/dao/types.js';
import type { Broker } from '../sse/broker.js';
import { predictBreach, type Point } from '../services/trend-prediction.js';
import {
  stepRiskState,
  performanceTopic,
  normalizeStatus,
} from './performance-ticker.js';
import { type Clock, systemClock } from './clock.js';
import type { DetectionLogger } from './seams.js';
import type { EscalationEngine } from '../services/escalation/policy.js';

/**
 * Host-metric ticker — the HOST layer of AI Incident PREVENTION ("predict
 * before" vs. "fix after"). Where the performance ticker predicts per-endpoint
 * SLO breaches from request telemetry, this loop predicts host RESOURCE
 * exhaustion (CPU / Memory / DB-pool) from `host_metric_samples`.
 *
 * Every `HOST_WINDOW_SEC`, mirroring the performance ticker's structure, it:
 *
 *   1. **self-samples** the platform's OWN process — real CPU% (a
 *      `process.cpuUsage` delta over the tick), real memory% (`rss` / total),
 *      and real pg-pool utilization (`pool.totalCount/idleCount/waitingCount`) —
 *      and appends it as a `host_metric_samples` row (so the platform's DB-pool
 *      bar is always live);
 *   2. for every service with recent samples, and every metric in
 *      [cpu, mem, db_pool], reads the trailing series, derives current +
 *      baseline, and predicts a breach against the metric's threshold via the
 *      SAME {@link predictBreach} trend engine the endpoint layer uses;
 *   3. advances the durable, flap-protected `risk_states` ladder (keyed
 *      `service = "host:<service>"`, `endpoint = <metric>`) via
 *      {@link stepRiskState};
 *   4. emits a `host_early_warning` SSE frame per metric, carrying the reused
 *      prediction plus a heuristic `likelyCause` + `recommendedAction`.
 *
 * Guards mirror the performance ticker: an `isAggregating` single-flight mutex
 * (never overlap windows), `Promise.allSettled` per (service, metric) so one bad
 * unit can't sink the window, and time read only through an injected `Clock`.
 */

/** Trailing samples pulled per metric for the baseline + trend regression. */
const SERIES_LIMIT = 20;

/** How far back (ms multiple of the window) to look for *active* services. */
const SERVICE_LOOKBACK_WINDOWS = 10;

/** The three tracked host metrics + their physical column and threshold. */
interface HostMetricDef {
  name: HostMetricName;
  column: HostMetricColumn;
  threshold: (c: Config) => number;
}

const HOST_METRICS: readonly HostMetricDef[] = [
  { name: 'cpu', column: 'cpu_pct', threshold: (c) => c.host.cpuThreshold },
  { name: 'mem', column: 'mem_pct', threshold: (c) => c.host.memThreshold },
  {
    name: 'db_pool',
    column: 'db_pool_pct',
    threshold: (c) => c.host.dbPoolThreshold,
  },
];

/** The `risk_states` service key host risk rows live under (kept separate from
 *  per-endpoint API risk rows, which use the real service name). */
export function hostRiskServiceKey(service: string): string {
  return `host:${service}`;
}

/**
 * Heuristic operator guidance per metric — the "increase connection pool
 * 100→150" style recommendation the AI EARLY WARNING card renders alongside the
 * prediction. A pure map so the read route reproduces it identically.
 */
export function hostGuidance(metric: HostMetricName): {
  likelyCause: string;
  recommendedAction: string;
} {
  switch (metric) {
    case 'db_pool':
      return {
        likelyCause:
          'Connection pool near capacity — requests are queueing for a free DB connection.',
        recommendedAction:
          'Increase connection pool (e.g. 100→150) or investigate a connection leak',
      };
    case 'cpu':
      return {
        likelyCause:
          'CPU saturating — a hot loop, heavy computation, or a traffic spike.',
        recommendedAction:
          'Scale up / add an instance; check for a hot loop or traffic spike',
      };
    case 'mem':
      return {
        likelyCause:
          'Memory climbing — a probable memory leak or an undersized heap.',
        recommendedAction:
          'Check for a memory leak; raise the memory limit or restart',
      };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function avg(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** The threshold for `metric` from config (used by the ticker + read route). */
export function hostThreshold(config: Config, metric: HostMetricName): number {
  const def = HOST_METRICS.find((d) => d.name === metric);
  return def ? def.threshold(config) : 100;
}

/** The `host_metric_samples` column backing a `HostMetricName`. */
export function hostMetricColumn(metric: HostMetricName): HostMetricColumn {
  const def = HOST_METRICS.find((d) => d.name === metric);
  return def ? def.column : 'cpu_pct';
}

/** The scored + predicted result for one (service, metric). */
export interface HostMetricComputed {
  service: string;
  metric: HostMetricName;
  current: number;
  baseline: number;
  threshold: number;
  prediction: RiskPrediction;
  /** Recent readings oldest→newest (the sparkline). */
  series: number[];
  likelyCause: string;
  recommendedAction: string;
}

/**
 * Compute the trend/breach prediction for one metric from its trailing series
 * (as returned by the DAO, newest-first). Pure + deterministic, so the read
 * route reconstructs the exact same DTO the ticker produced. Returns `null` when
 * the series is empty (the metric isn't reported for this service).
 *
 * Baseline is the trailing average of prior readings (all but the latest); the
 * per-point minutes fed to {@link predictBreach} are derived from the *actual*
 * sample timestamps, so `minutesToBreach` reflects real time regardless of the
 * host sampling rate.
 */
export function computeHostMetric(
  service: string,
  metric: HostMetricName,
  seriesNewestFirst: readonly HostMetricPoint[],
  threshold: number,
): HostMetricComputed | null {
  if (seriesNewestFirst.length === 0) return null;
  const oldestFirst = [...seriesNewestFirst].reverse();
  const values = oldestFirst.map((p) => p.value);
  const current = values[values.length - 1]!;
  const prior = values.slice(0, -1);
  const baseline = prior.length > 0 ? avg(prior) : current;

  const n = oldestFirst.length;
  const firstTs = oldestFirst[0]!.timestamp;
  const lastTs = oldestFirst[n - 1]!.timestamp;
  const perPointMinutes =
    n > 1 && lastTs > firstTs ? (lastTs - firstTs) / (n - 1) / 60_000 : 0.5;

  const points: Point[] = oldestFirst.map((p) => ({
    t: p.timestamp,
    value: p.value,
  }));
  const prediction = predictBreach(points, threshold, baseline, current, {
    windowMinutes: perPointMinutes,
  });

  const g = hostGuidance(metric);
  return {
    service,
    metric,
    current,
    baseline,
    threshold,
    prediction,
    series: values,
    likelyCause: g.likelyCause,
    recommendedAction: g.recommendedAction,
  };
}

export interface HostTickerOptions {
  db: OncallDb;
  config: Config;
  broker?: Broker;
  clock?: Clock;
  logger?: DetectionLogger;
  /** Escalation ladder engine (ESCALATE IF IGNORED). Optional — skipped if absent. */
  escalation?: EscalationEngine;
}

/** Per-tick summary (returned from `aggregate()` for tests + logging). */
export interface HostTickResult {
  now: number;
  servicesEvaluated: number;
  metricsProcessed: number;
  failed: number;
}

export class HostTicker {
  private readonly db: OncallDb;
  private readonly config: Config;
  private readonly broker?: Broker;
  private readonly clock: Clock;
  private readonly log: DetectionLogger;
  private readonly escalation?: EscalationEngine;

  private timer?: ReturnType<typeof setInterval>;
  private isAggregating = false; // single-flight mutex (never overlap windows)

  // Rolling state for the platform self-CPU% delta.
  private lastCpu?: NodeJS.CpuUsage;
  private lastCpuAt?: number;

  constructor(opts: HostTickerOptions) {
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

  /** Start the `HOST_WINDOW_SEC` loop. Idempotent; no-op when disabled. */
  start(): void {
    if (!this.config.host.enabled) {
      this.log('[host] ticker disabled (HOST_ENABLED=false)');
      return;
    }
    if (this.timer) return;
    const intervalMs = this.config.host.windowSec * 1000;
    this.timer = setInterval(() => {
      if (this.isAggregating) return; // never overlap windows
      this.isAggregating = true;
      void this.aggregate()
        .catch((err: unknown) => this.log('[host] aggregate error', err))
        .finally(() => {
          this.isAggregating = false;
        });
    }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log('[host] ticker started', { windowSec: this.config.host.windowSec });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.log('[host] ticker stopped');
    }
  }

  /** Run exactly one host aggregation window across every active service. */
  async aggregate(): Promise<HostTickResult> {
    const now = this.clock.now();

    // 1) self-sample the platform's own process + pg pool (best-effort).
    try {
      await this.db.dao.hostMetricSamples.insertMany([this.sampleSelf(now)]);
    } catch (err) {
      this.log('[host] self-sample failed', err);
    }

    // 2) discover services that reported recently.
    const lookback = this.config.host.windowSec * SERVICE_LOOKBACK_WINDOWS * 1000;
    const services = await this.db.dao.hostMetricSamples.listServicesInWindow(
      now - lookback,
      now,
    );

    // 3) process every (service, metric) unit — one bad unit can't sink others.
    const units: Array<{ service: string; def: HostMetricDef }> = [];
    for (const service of services) {
      for (const def of HOST_METRICS) units.push({ service, def });
    }
    const settled = await Promise.allSettled(
      units.map((u) => this.processMetric(u.service, u.def, now)),
    );

    let metricsProcessed = 0;
    let failed = 0;
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        if (s.value) metricsProcessed++;
      } else {
        failed++;
        this.log('[host] metric failed', s.reason);
      }
    }

    return {
      now,
      servicesEvaluated: services.length,
      metricsProcessed,
      failed,
    };
  }

  /**
   * Roll one (service, metric) up: read the trailing series, predict a breach,
   * advance the flap-protected risk state, and stream the early-warning frame.
   * Returns `false` (skipped) when the metric has no data for this service.
   */
  private async processMetric(
    service: string,
    def: HostMetricDef,
    now: number,
  ): Promise<boolean> {
    const series = await this.db.dao.hostMetricSamples.recentSeries(
      service,
      def.column,
      SERIES_LIMIT,
    );
    const computed = computeHostMetric(
      service,
      def.name,
      series,
      def.threshold(this.config),
    );
    if (!computed) return false;

    const key = hostRiskServiceKey(service);
    const prev = await this.db.dao.riskStates.get(key, def.name);
    const next = stepRiskState(prev, computed.prediction, now);
    await this.db.dao.riskStates.upsert({
      service_name: key,
      endpoint: def.name,
      status: next.status,
      first_detected_at: next.firstDetectedAt,
      last_escalated_at: next.lastEscalatedAt,
      consecutive_risk_windows: next.consecutiveRisk,
      consecutive_healthy_windows: next.consecutiveHealthy,
      current_risk_score: computed.prediction.riskScore,
      prediction_details: JSON.stringify(computed.prediction),
      updated_at: now,
    });

    this.publishEarlyWarning(computed, next.status);

    // ESCALATE IF IGNORED — advance the escalation ladder for this host metric.
    if (this.escalation) {
      await this.escalation.onRiskUpdate({
        source: 'host',
        service,
        metric: def.name,
        riskService: key,
        riskEndpoint: def.name,
        prevStatus: normalizeStatus(prev?.status),
        status: next.status,
        current: computed.current,
        threshold: computed.threshold,
        probability: computed.prediction.probability,
        minutesToBreach: computed.prediction.minutesToBreach,
        likelyCause: computed.likelyCause,
        recommendedAction: computed.recommendedAction,
        title: `${service} ${def.name} resource risk`,
        now,
      });
    }
    return true;
  }

  /** Stream one `host_early_warning` frame on the performance topic. */
  private publishEarlyWarning(
    computed: HostMetricComputed,
    status: RiskStatus,
  ): void {
    if (!this.broker) return;
    this.broker.publish(performanceTopic(), {
      event: 'host_early_warning',
      data: {
        service: computed.service,
        metric: computed.metric,
        status,
        current: Math.round(computed.current * 10) / 10,
        threshold: computed.threshold,
        probability: computed.prediction.probability,
        minutesToBreach: computed.prediction.minutesToBreach,
        likelyCause: computed.likelyCause,
        recommendedAction: computed.recommendedAction,
      },
    });
  }

  /** Sample the platform's own process CPU/mem + pg-pool utilization. */
  private sampleSelf(now: number): CreateHostMetricSampleInput {
    return {
      host: os.hostname(),
      service: this.config.host.selfService,
      timestamp: now,
      cpu_pct: this.processCpuPct(now),
      mem_pct: this.processMemPct(),
      db_pool_pct: this.poolUtilizationPct(),
      event_loop_lag_ms: null,
    };
  }

  /** Real process CPU% as a `process.cpuUsage` delta over the tick interval,
   *  normalized by core count (0 on the first tick — no prior baseline yet). */
  private processCpuPct(now: number): number {
    const usage = process.cpuUsage();
    if (this.lastCpu === undefined || this.lastCpuAt === undefined) {
      this.lastCpu = usage;
      this.lastCpuAt = now;
      return 0;
    }
    const elapsedMs = now - this.lastCpuAt;
    const userDeltaUs = usage.user - this.lastCpu.user;
    const sysDeltaUs = usage.system - this.lastCpu.system;
    this.lastCpu = usage;
    this.lastCpuAt = now;
    if (elapsedMs <= 0) return 0;
    const cpuMs = (userDeltaUs + sysDeltaUs) / 1000; // microseconds → ms
    const cores = Math.max(1, os.cpus()?.length ?? 1);
    return clamp((cpuMs / (elapsedMs * cores)) * 100, 0, 100);
  }

  /** Real process memory% as `rss` against total system memory. */
  private processMemPct(): number {
    const totalMem = os.totalmem();
    if (totalMem <= 0) return 0;
    const rss = process.memoryUsage().rss;
    return clamp((rss / totalMem) * 100, 0, 100);
  }

  /**
   * Real pg-pool utilization% from the shared pool's live counters: active
   * clients (`totalCount − idleCount`) plus queued demand (`waitingCount`)
   * against the pool ceiling (`options.max`). Clamped 0-100.
   */
  private poolUtilizationPct(): number {
    const pool = this.db.pool as unknown as {
      totalCount?: number;
      idleCount?: number;
      waitingCount?: number;
      options?: { max?: number };
    };
    const max = Math.max(1, pool.options?.max ?? 10);
    const total = pool.totalCount ?? 0;
    const idle = pool.idleCount ?? 0;
    const waiting = pool.waitingCount ?? 0;
    const active = Math.max(0, total - idle);
    return clamp(((active + waiting) / max) * 100, 0, 100);
  }
}

/** Factory mirroring the detection-engine / performance-ticker convention. */
export function createHostTicker(opts: HostTickerOptions): HostTicker {
  return new HostTicker(opts);
}
