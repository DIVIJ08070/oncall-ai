import type BetterSqlite3 from 'better-sqlite3';
import type { LogLevel } from '@oncall/shared';
import { percentile } from './percentile.js';

/**
 * Trailing-window rollup over `log_events` (SPEC §10.2, FR-04). Produces the
 * request volume, error rate, and latency percentiles that both the detection
 * loop (§10.3) and the `/metrics` + `/services` DTOs (§7.2) are built from.
 *
 * **Request vs. error classification (SPEC §10.2):**
 *   - A *request* event is one that carries a `status` or a `latency_ms` — those
 *     are the events percentiles are drawn from ("events with a `status`/
 *     `latency_ms` count as requests").
 *   - An *error* event is a `level = "error"` log **or** any event whose HTTP
 *     `status >= 500`.
 *   - `request_count` folds error events into the denominator so that
 *     `error_rate = error_count / max(request_count, 1)` (the literal §10.2
 *     formula) is always a true fraction in `[0, 1]` and the stored
 *     `metric_samples` columns stay internally consistent. In healthy operation
 *     (no error logs) this reduces to the raw request volume.
 */

/** Minimal per-event shape the rollup needs (a projection of `log_events`, §8). */
export interface RollupEvent {
  timestamp: number;
  level: LogLevel;
  status: number | null;
  latency_ms: number | null;
  fingerprint_sig: string | null;
}

/** Result of a single window rollup. */
export interface Rollup {
  /** Denominator for `error_rate`: request events ∪ error events (see module doc). */
  request_count: number;
  error_count: number;
  /** `error_count / max(request_count, 1)` ∈ [0, 1] (SPEC §10.2). */
  error_rate: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  /** Raw request-event volume (status/latency-bearing events only), for `req_per_min`. */
  raw_request_count: number;
  /** Most frequent `fingerprint_sig` among error events; `""` when no errors (SPEC §10.2). */
  dominant_sig: string;
  /** Earliest error-event timestamp in the window (`null` when no errors). */
  first_error_at: number | null;
}

export function isRequestEvent(e: RollupEvent): boolean {
  return e.status !== null || e.latency_ms !== null;
}

export function isErrorEvent(e: RollupEvent): boolean {
  return e.level === 'error' || (e.status !== null && e.status >= 500);
}

/** The empty rollup (no events in the window). */
export function emptyRollup(): Rollup {
  return {
    request_count: 0,
    error_count: 0,
    error_rate: 0,
    p50_ms: 0,
    p95_ms: 0,
    p99_ms: 0,
    raw_request_count: 0,
    dominant_sig: '',
    first_error_at: null,
  };
}

/**
 * Most frequent `fingerprint_sig` among the given error events (SPEC §10.2
 * `dominant_sig`). Ties are broken deterministically by lexical order of the
 * signature so the resulting incident fingerprint is stable across ticks.
 */
export function dominantSignature(errorEvents: readonly RollupEvent[]): string {
  const counts = new Map<string, number>();
  for (const e of errorEvents) {
    const sig = e.fingerprint_sig ?? '';
    if (sig === '') continue;
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [sig, count] of counts) {
    if (count > bestCount || (count === bestCount && sig < best)) {
      best = sig;
      bestCount = count;
    }
  }
  return best;
}

/** Pure rollup of an in-memory event list (deterministic; the testable core). */
export function computeRollup(events: readonly RollupEvent[]): Rollup {
  if (events.length === 0) return emptyRollup();

  const errorEvents = events.filter(isErrorEvent);
  const requestEvents = events.filter(isRequestEvent);

  // Denominator = request events ∪ error events (dedup by identity). Since an
  // event can be both a request (status/latency) and an error (level/status>=500),
  // count the union to keep error_count <= request_count.
  let unionCount = 0;
  for (const e of events) {
    if (isRequestEvent(e) || isErrorEvent(e)) unionCount++;
  }

  const latencies: number[] = [];
  for (const e of requestEvents) {
    if (e.latency_ms !== null) latencies.push(e.latency_ms);
  }

  const error_count = errorEvents.length;
  const request_count = unionCount;
  const error_rate = error_count / Math.max(request_count, 1);

  let first_error_at: number | null = null;
  for (const e of errorEvents) {
    if (first_error_at === null || e.timestamp < first_error_at) {
      first_error_at = e.timestamp;
    }
  }

  return {
    request_count,
    error_count,
    error_rate,
    p50_ms: percentile(latencies, 50),
    p95_ms: percentile(latencies, 95),
    p99_ms: percentile(latencies, 99),
    raw_request_count: requestEvents.length,
    dominant_sig: dominantSignature(errorEvents),
    first_error_at,
  };
}

/**
 * Read the projected events of a `[fromTs, toTs]` window for one service,
 * ordered by time. Reads via the `(customer_id, service, timestamp)` index (§8).
 * Windowing is on event `timestamp` (client/event time), consistent with the
 * `metric_samples` series and the `get_metrics` tool.
 */
export function readWindowEvents(
  raw: BetterSqlite3.Database,
  customerId: string,
  service: string,
  fromTs: number,
  toTs: number,
): RollupEvent[] {
  return raw
    .prepare(
      `SELECT timestamp, level, status, latency_ms, fingerprint_sig
         FROM log_events
        WHERE customer_id = ? AND service = ?
          AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC`,
    )
    .all(customerId, service, fromTs, toTs) as RollupEvent[];
}

/** Read + roll up a `[fromTs, toTs]` window straight from the database. */
export function rollupWindow(
  raw: BetterSqlite3.Database,
  customerId: string,
  service: string,
  fromTs: number,
  toTs: number,
): Rollup {
  return computeRollup(readWindowEvents(raw, customerId, service, fromTs, toTs));
}
