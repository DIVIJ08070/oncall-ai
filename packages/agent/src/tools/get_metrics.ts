import {
  GetMetricsInputSchema,
  type GetMetricsInput,
  type GetMetricsOutput,
  type MetricSample,
} from '@oncall/shared';
import type { ToolContext } from '../ports.js';
import { METRICS_SERIES_MAX, enforceResultCap } from '../bounded.js';

/**
 * Tool 2 — `get_metrics` (SPEC §9). Reads `metric_samples` (one row per
 * detection tick, §10.1) for a service. `current` = the latest sample;
 * `baseline` = the mean over the trailing-5-min-minus-60s window (§10.2);
 * `series` = the samples across `window_sec`, capped to 60 points.
 */
const BASELINE_LAG_MS = 60_000; // exclude the most recent 60 s (§10.2)
const BASELINE_SPAN_MS = 300_000; // trailing 5 min

export async function getMetrics(
  ctx: ToolContext,
  input: GetMetricsInput,
): Promise<GetMetricsOutput> {
  const now = Date.now();
  const customerId = ctx.customer.id;
  const service = input.service;
  const windowMs = input.window_sec * 1000;

  const samples = ctx.db.dao.metricSamples.seriesForService(
    customerId,
    service,
    now - windowMs,
    240,
  );

  const latest =
    samples.length > 0
      ? samples[samples.length - 1]
      : ctx.db.dao.metricSamples.latestForService(customerId, service);

  const current = latest
    ? {
        error_rate: latest.error_rate,
        req_count: latest.request_count,
        p50_ms: latest.p50_ms,
        p95_ms: latest.p95_ms,
        p99_ms: latest.p99_ms,
      }
    : { error_rate: 0, req_count: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0 };

  const baseline = computeBaseline(samples, now);

  // series: most-recent 60 points, oldest→newest (samples are ascending).
  const seriesSamples = samples.slice(-METRICS_SERIES_MAX);
  const series = seriesSamples.map((s) => ({
    ts: s.bucket_ts,
    error_rate: s.error_rate,
    req_count: s.request_count,
    p95_ms: s.p95_ms,
  }));

  const out: GetMetricsOutput = {
    service,
    window_sec: input.window_sec,
    current,
    baseline,
    series,
  };
  return enforceResultCap(out, 'series');
}

function computeBaseline(
  samples: readonly MetricSample[],
  now: number,
): { error_rate: number; p95_ms: number } {
  const lo = now - BASELINE_SPAN_MS;
  const hi = now - BASELINE_LAG_MS;
  const window = samples.filter((s) => s.bucket_ts >= lo && s.bucket_ts <= hi);
  if (window.length === 0) return { error_rate: 0, p95_ms: 0 };
  const meanErr =
    window.reduce((n, s) => n + s.error_rate, 0) / window.length;
  const meanP95 = Math.round(
    window.reduce((n, s) => n + s.p95_ms, 0) / window.length,
  );
  return { error_rate: meanErr, p95_ms: meanP95 };
}

export const getMetricsMeta = {
  name: 'get_metrics' as const,
  description:
    'Read computed metric_samples for a service: current error_rate/req_count/p50/p95/p99, a trailing baseline, and a capped time series. Read-only.',
  inputSchema: GetMetricsInputSchema,
};
