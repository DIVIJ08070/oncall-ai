import type {
  HealthStatus,
  MetricsCurrent,
  MetricsSnapshot,
  MetricsSeriesPoint,
  ServiceHealth,
  ServicesResponse,
} from '@oncall/shared';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';
import type { ServiceRow } from '../db/rows.js';
import { rollupWindow, type Rollup } from './rollup.js';
import { computeBaseline } from './baseline.js';
import { currentRange, WINDOW_MS, WINDOW_SEC } from './windows.js';

/**
 * `/metrics` + `/services` DTO builders (SPEC §7.2, FR-04/14). C5 owns the
 * computation; the read routes that surface these land in C10 (which decides
 * status codes such as `404 not_found`). Everything here is a pure function of
 * `(db, customerId, now)` so C10 and tests call it deterministically with an
 * injected `now`.
 */

const SERIES_CAP = 240;

/** Requests-per-minute from a window rollup (SPEC §7.2 `req_per_min`). */
function reqPerMin(rawRequestCount: number): number {
  return (rawRequestCount * 60000) / WINDOW_MS;
}

/** Map a current rollup + heartbeat to a health badge (SPEC §7.2, §10.3 bars). */
export function classifyHealth(
  rollup: Rollup,
  lastEventAt: number | null,
  now: number,
  config: Config,
): HealthStatus {
  const d = config.detection;
  if (lastEventAt !== null && now - lastEventAt >= d.silenceWindowMs) {
    return 'silent';
  }
  const hasVolume = rollup.request_count >= d.minRequestsForDetection;
  if (hasVolume && rollup.error_rate >= d.errorRateThreshold) return 'down';
  if (hasVolume && rollup.p95_ms >= d.latencyP95ThresholdMs) return 'degraded';
  return 'healthy';
}

function toCurrent(rollup: Rollup): MetricsCurrent {
  return {
    error_rate: rollup.error_rate,
    req_count: rollup.request_count,
    p50_ms: rollup.p50_ms,
    p95_ms: rollup.p95_ms,
    p99_ms: rollup.p99_ms,
  };
}

/**
 * Build the `GET /metrics` snapshot for one service (SPEC §7.2). `current` is the
 * live trailing-60 s rollup; `baseline` is the trailing-5 min-minus-60 s rollup;
 * `series` comes from the persisted `metric_samples` rows over `window_sec`,
 * capped to 240 points. Returns `null` when the service is unknown (→ C10 404s).
 */
export function buildMetricsSnapshot(
  db: OncallDb,
  customerId: string,
  opts: { service: string; window_sec?: number; resolution_sec?: number; now?: number },
): MetricsSnapshot | null {
  const service = opts.service;
  const now = opts.now ?? Date.now();
  const windowSec = opts.window_sec ?? 900;
  const resolutionSec = opts.resolution_sec ?? WINDOW_SEC;

  const svc = db.dao.services.getByName(customerId, service);
  if (!svc) return null;

  const { from, to } = currentRange(now);
  const current = rollupWindow(db.raw, customerId, service, from, to);
  const baseline = computeBaseline(db.raw, customerId, service, now);

  const sinceTs = now - windowSec * 1000;
  const samples = db.dao.metricSamples.seriesForService(
    customerId,
    service,
    sinceTs,
    SERIES_CAP,
  );
  const series: MetricsSeriesPoint[] = samples.map((s) => ({
    ts: s.bucket_ts,
    error_rate: s.error_rate,
    req_count: s.request_count,
    p50_ms: s.p50_ms,
    p95_ms: s.p95_ms,
    p99_ms: s.p99_ms,
  }));

  return {
    service,
    window_sec: windowSec,
    resolution_sec: resolutionSec,
    current: toCurrent(current),
    baseline,
    series,
  };
}

/** Build one `GET /services` entry from a service row (SPEC §7.2). */
export function buildServiceHealth(
  db: OncallDb,
  customerId: string,
  svc: ServiceRow,
  now: number,
  config: Config,
): ServiceHealth {
  const { from, to } = currentRange(now);
  const rollup = rollupWindow(db.raw, customerId, svc.name, from, to);
  const active = db.dao.incidents.list({
    customer_id: customerId,
    service: svc.name,
    activeOnly: true,
    limit: 1,
  });
  return {
    name: svc.name,
    health: classifyHealth(rollup, svc.last_event_at, now, config),
    error_rate: rollup.error_rate,
    p95_ms: rollup.p95_ms,
    req_per_min: reqPerMin(rollup.raw_request_count),
    last_event_at: svc.last_event_at,
    active_incident_id: active[0]?.id ?? null,
  };
}

/** Build the full `GET /services` response for a customer (SPEC §7.2). */
export function buildServicesResponse(
  db: OncallDb,
  customerId: string,
  now: number,
  config: Config,
): ServicesResponse {
  const services = db.dao.services.listByCustomer(customerId);
  return {
    services: services.map((svc) =>
      buildServiceHealth(db, customerId, svc, now, config),
    ),
  };
}
