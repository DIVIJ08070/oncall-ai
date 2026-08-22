/**
 * Victim HOST sampler (AI Incident PREVENTION — HOST early warning).
 *
 * Every `VICTIM_HOST_SAMPLE_MS` (~5s) this ships one point-in-time resource
 * reading of the victim process to the platform's `POST /api/v1/ingest` under
 * `{ host_metrics: [...] }` — the raw source the platform host-ticker rolls up
 * per (service, metric) into a trend prediction for the AI EARLY WARNING card.
 * Every reading is:
 *   - **REAL** where it can be: process CPU% (a `process.cpuUsage` delta over the
 *     tick, normalized by core count), memory% (`rss` against a simulated
 *     container ceiling so the bar reads like a real limit), and event-loop lag
 *     (`monitorEventLoopDelay` mean over the tick) as a saturation proxy;
 *   - **overlaid** by any active HOST degrade — a `cpu` / `dbpool` degrade ramps
 *     the reported cpu_pct / db_pool_pct upward (40→…→95) so the demo shows the
 *     metric climbing toward its threshold with a rising breach prediction.
 *
 * Fail-silent (NFR-04): a shipping failure never throws and never impacts the
 * app — the host sampler is pure observability. The timer is `unref()`'d so it
 * never keeps the process alive on its own.
 */

import os from 'node:os';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { config } from './config.js';
import { hostDegradeEffect } from './control.js';

/** Wire shape per host reading (matches the platform `HostMetricSchema`). */
interface HostMetricWire {
  host: string;
  service: string;
  timestamp: number;
  cpu_pct: number;
  mem_pct: number;
  db_pool_pct: number | null;
  event_loop_lag_ms: number | null;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Batched-free, fail-silent host resource sampler for the victim process. */
export class HostSampler {
  private readonly ingestUrl: string;
  private readonly apiKey: string;
  private readonly service: string;
  private readonly intervalMs: number;
  private readonly memCeilingBytes: number;
  private readonly onError?: (err: unknown) => void;

  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lag: IntervalHistogram;
  private lastCpu?: NodeJS.CpuUsage;
  private lastCpuAt?: number;
  private closed = false;

  constructor(opts?: { onError?: (err: unknown) => void }) {
    this.ingestUrl = config.ingestUrl;
    this.apiKey = config.apiKey;
    this.service = config.hostService;
    this.intervalMs = Math.max(1000, config.hostSampleMs);
    this.memCeilingBytes = Math.max(1, config.memCeilingMb) * 1024 * 1024;
    this.onError = opts?.onError;
    this.lag = monitorEventLoopDelay({ resolution: 20 });
  }

  /** Start the sampling loop (idempotent). Records a CPU baseline immediately. */
  start(): void {
    if (this.timer) return;
    this.closed = false;
    this.lag.enable();
    // Prime the CPU delta baseline so the first shipped tick carries a real %.
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = Date.now();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  /** Stop the loop (idempotent). */
  stop(): void {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lag.disable();
  }

  /** Build the current reading, overlay any active HOST degrade, and ship it. */
  private async tick(): Promise<void> {
    if (this.closed) return;
    try {
      await this.ship(this.sample(Date.now()));
    } catch (err) {
      this.report(err);
    }
  }

  /** Compose one reading (real metrics, then degrade overlay). */
  sample(now: number): HostMetricWire {
    const cpuReal = this.processCpuPct(now);
    const memReal = this.processMemPct();
    const lagMs = this.eventLoopLagMs();

    const degrade = hostDegradeEffect(now);
    const cpu = degrade.cpuPct ?? cpuReal;
    const dbPool = degrade.dbPoolPct; // null unless a dbpool degrade is active

    return {
      host: os.hostname(),
      service: this.service,
      timestamp: now,
      cpu_pct: Math.round(cpu * 10) / 10,
      mem_pct: Math.round(memReal * 10) / 10,
      db_pool_pct: dbPool == null ? null : Math.round(dbPool * 10) / 10,
      event_loop_lag_ms: lagMs == null ? null : Math.round(lagMs * 100) / 100,
    };
  }

  /** Real process CPU% as a `process.cpuUsage` delta over the tick interval. */
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
    return clampPct((cpuMs / (elapsedMs * cores)) * 100);
  }

  /** Real process memory% as `rss` against the simulated container ceiling. */
  private processMemPct(): number {
    const rss = process.memoryUsage().rss;
    return clampPct((rss / this.memCeilingBytes) * 100);
  }

  /** Mean event-loop lag (ms) over the elapsed tick, then reset the histogram. */
  private eventLoopLagMs(): number | null {
    const mean = this.lag.mean; // nanoseconds
    this.lag.reset();
    if (!Number.isFinite(mean) || mean <= 0) return null;
    return mean / 1e6;
  }

  /** POST one reading as a `host_metrics` batch. Fail-silent (NFR-04). */
  private async ship(metric: HostMetricWire): Promise<void> {
    const doFetch = globalThis.fetch;
    if (typeof doFetch !== 'function') {
      this.report(new Error('no fetch implementation available'));
      return;
    }
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 5000);
    to.unref?.();
    try {
      const res = await doFetch(this.ingestUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ingest-key': this.apiKey,
        },
        body: JSON.stringify({ host_metrics: [metric] }),
        signal: controller.signal,
      });
      if (res && typeof res.ok === 'boolean' && !res.ok) {
        this.report(new Error(`host ingest responded ${res.status}`));
      }
    } catch (err) {
      this.report(err);
    } finally {
      clearTimeout(to);
    }
  }

  private report(err: unknown): void {
    try {
      this.onError?.(err);
    } catch {
      // An onError that itself throws must never surface.
    }
  }
}

/** Start a host sampler for the victim process. Returns the running instance. */
export function startHostSampler(opts?: {
  onError?: (err: unknown) => void;
}): HostSampler {
  const sampler = new HostSampler(opts);
  sampler.start();
  return sampler;
}
