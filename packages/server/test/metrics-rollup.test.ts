import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openMemoryDatabase, type OncallDb } from '../src/db/index.js';
import { loadConfig, type Config } from '../src/config.js';
import {
  percentile,
  computeRollup,
  dominantSignature,
  isRequestEvent,
  isErrorEvent,
  rollupWindow,
  computeBaseline,
  buildMetricsSnapshot,
  buildServiceHealth,
  buildServicesResponse,
  classifyHealth,
  type RollupEvent,
} from '../src/metrics/index.js';

/**
 * C5 metrics tests (SPEC §10.2 rollup + baseline, §7.2 `/metrics` & `/services`
 * DTOs). Pure rollup math is asserted directly; DB-backed paths use synthetic
 * `log_events` with explicit timestamps + an injected `now`.
 */

const KEY = 'metrics-test-key';
const SERVICE = 'checkout-api';

let db: OncallDb;
let customerId: string;
let config: Config;

beforeEach(() => {
  db = openMemoryDatabase();
  customerId = db.dao.customers.create({ name: 'acme', ingest_api_key: KEY }).id;
  config = loadConfig({ INGEST_API_KEY: KEY });
});

afterEach(() => {
  db.close();
});

function ev(over: Partial<RollupEvent> = {}): RollupEvent {
  return {
    timestamp: 1000,
    level: 'info',
    status: 200,
    latency_ms: 50,
    fingerprint_sig: null,
    ...over,
  };
}

/** Insert log_events + register the service heartbeat (mimics the ingest writer). */
function ingest(
  service: string,
  specs: Array<Partial<RollupEvent> & { message?: string }>,
): void {
  let maxTs = 0;
  for (const s of specs) {
    const timestamp = s.timestamp ?? 1000;
    maxTs = Math.max(maxTs, timestamp);
    db.dao.logEvents.insert({
      customer_id: customerId,
      service,
      level: s.level ?? 'info',
      message: s.message ?? 'GET /x 200',
      timestamp,
      status: s.status ?? null,
      latency_ms: s.latency_ms ?? null,
      fingerprint_sig: s.fingerprint_sig ?? null,
    });
  }
  db.dao.services.touch(customerId, service, maxTs);
}

describe('percentile', () => {
  it('empty → 0, single → itself', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([42], 95)).toBe(42);
  });

  it('computes percentiles by linear interpolation (type-7)', () => {
    const vals = [10, 20, 30, 40, 50];
    expect(percentile(vals, 0)).toBe(10);
    expect(percentile(vals, 50)).toBe(30); // exact middle rank
    expect(percentile(vals, 95)).toBe(48); // 40 + 0.8*(50-40)
    expect(percentile(vals, 100)).toBe(50);
    // 1..100: median rank 49.5 → 50.5 → rounds to 51; tails land on their bucket.
    const big = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(big, 50)).toBe(51);
    expect(percentile(big, 95)).toBe(95);
    expect(percentile(big, 99)).toBe(99);
  });
});

describe('event classification (SPEC §10.2)', () => {
  it('request = has status or latency; error = level error or status>=500', () => {
    expect(isRequestEvent(ev({ status: 200, latency_ms: null }))).toBe(true);
    expect(isRequestEvent(ev({ status: null, latency_ms: 10 }))).toBe(true);
    expect(isRequestEvent(ev({ status: null, latency_ms: null }))).toBe(false);

    expect(isErrorEvent(ev({ level: 'error', status: null }))).toBe(true);
    expect(isErrorEvent(ev({ level: 'info', status: 500 }))).toBe(true);
    expect(isErrorEvent(ev({ level: 'info', status: 200 }))).toBe(false);
  });
});

describe('computeRollup (SPEC §10.2)', () => {
  it('healthy traffic → error_rate 0 and percentiles from latency', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      ev({ status: 200, latency_ms: (i + 1) * 10 }),
    );
    const r = computeRollup(events);
    expect(r.error_count).toBe(0);
    expect(r.error_rate).toBe(0);
    expect(r.request_count).toBe(10);
    expect(r.raw_request_count).toBe(10);
    expect(r.p50_ms).toBeGreaterThan(0);
    expect(r.dominant_sig).toBe('');
    expect(r.first_error_at).toBeNull();
  });

  it('error_rate = error_count / request_count and stays in [0,1]', () => {
    const events = [
      ...Array.from({ length: 7 }, () => ev({ status: 200 })),
      ...Array.from({ length: 3 }, () =>
        ev({ level: 'error', status: 500, fingerprint_sig: 'boom <n>' }),
      ),
    ];
    const r = computeRollup(events);
    expect(r.error_count).toBe(3);
    expect(r.request_count).toBe(10);
    expect(r.error_rate).toBeCloseTo(0.3, 10);
    expect(r.error_rate).toBeLessThanOrEqual(1);
  });

  it('pure error logs (no status/latency) still fold into the denominator', () => {
    const events = Array.from({ length: 4 }, () =>
      ev({ level: 'error', status: null, latency_ms: null, fingerprint_sig: 'x' }),
    );
    const r = computeRollup(events);
    expect(r.error_count).toBe(4);
    expect(r.request_count).toBe(4); // union folds errors in → rate = 1.0
    expect(r.error_rate).toBe(1);
    expect(r.raw_request_count).toBe(0);
  });

  it('dominant_sig = most frequent error signature; first_error_at = earliest', () => {
    const events = [
      ev({ level: 'error', status: 500, fingerprint_sig: 'a', timestamp: 300 }),
      ev({ level: 'error', status: 500, fingerprint_sig: 'b', timestamp: 200 }),
      ev({ level: 'error', status: 500, fingerprint_sig: 'b', timestamp: 400 }),
    ];
    const r = computeRollup(events);
    expect(r.dominant_sig).toBe('b');
    expect(r.first_error_at).toBe(200);
  });

  it('dominantSignature ignores empty sigs and breaks ties lexically', () => {
    expect(dominantSignature([])).toBe('');
    expect(
      dominantSignature([
        ev({ fingerprint_sig: null }),
        ev({ fingerprint_sig: '' }),
      ]),
    ).toBe('');
    expect(
      dominantSignature([
        ev({ fingerprint_sig: 'zzz' }),
        ev({ fingerprint_sig: 'aaa' }),
      ]),
    ).toBe('aaa'); // tie → lexical
  });
});

describe('rollupWindow + baseline (SPEC §10.2)', () => {
  it('windows on event timestamp', () => {
    ingest(SERVICE, [
      { status: 200, latency_ms: 10, timestamp: 1000 },
      { status: 200, latency_ms: 20, timestamp: 2000 },
      { status: 500, level: 'error', fingerprint_sig: 'e', timestamp: 5000 },
    ]);
    // Window [1500, 6000] excludes the first event.
    const r = rollupWindow(db.raw, customerId, SERVICE, 1500, 6000);
    expect(r.request_count).toBe(2); // 1 healthy(2000) + 1 error(5000)
    expect(r.error_count).toBe(1);
  });

  it('baseline excludes the most recent 60s', () => {
    const now = 1_000_000;
    // Recent-60s errors (should NOT appear in baseline).
    ingest(SERVICE, [
      { status: 500, level: 'error', fingerprint_sig: 'e', timestamp: now - 10_000 },
      { status: 500, level: 'error', fingerprint_sig: 'e', timestamp: now - 20_000 },
    ]);
    // Older healthy traffic inside the baseline window [now-300s, now-60s].
    for (let i = 0; i < 20; i++) {
      ingest(SERVICE, [
        { status: 200, latency_ms: 30, timestamp: now - 120_000 - i * 1000 },
      ]);
    }
    const baseline = computeBaseline(db.raw, customerId, SERVICE, now);
    expect(baseline.error_rate).toBe(0); // recent errors excluded
    expect(baseline.p95_ms).toBeGreaterThan(0);
  });
});

describe('classifyHealth (SPEC §7.2 / §10.3)', () => {
  const now = 500_000;
  it('silent when last_event_at older than the silence window', () => {
    const r = computeRollup([]);
    expect(
      classifyHealth(r, now - config.detection.silenceWindowMs - 1, now, config),
    ).toBe('silent');
  });

  it('down on error-rate breach, degraded on latency breach, else healthy', () => {
    const down = computeRollup(
      Array.from({ length: 10 }, (_, i) =>
        ev({ status: i < 5 ? 500 : 200, level: i < 5 ? 'error' : 'info' }),
      ),
    );
    expect(classifyHealth(down, now, now, config)).toBe('down');

    const slow = computeRollup(
      Array.from({ length: 8 }, () => ev({ status: 200, latency_ms: 2000 })),
    );
    expect(classifyHealth(slow, now, now, config)).toBe('degraded');

    const ok = computeRollup(
      Array.from({ length: 8 }, () => ev({ status: 200, latency_ms: 30 })),
    );
    expect(classifyHealth(ok, now, now, config)).toBe('healthy');
  });

  it('below the min-request floor never flags down/degraded', () => {
    const few = computeRollup([
      ev({ status: 500, level: 'error' }),
      ev({ status: 500, level: 'error' }),
    ]);
    expect(classifyHealth(few, now, now, config)).toBe('healthy');
  });
});

describe('buildMetricsSnapshot + services DTOs (SPEC §7.2)', () => {
  it('returns null for an unknown service', () => {
    expect(
      buildMetricsSnapshot(db, customerId, { service: 'nope', now: 1000 }),
    ).toBeNull();
  });

  it('assembles current + baseline + series (capped, from metric_samples)', () => {
    const now = 2_000_000;
    ingest(SERVICE, [
      { status: 200, latency_ms: 40, timestamp: now - 5000 },
      { status: 500, level: 'error', fingerprint_sig: 'e', timestamp: now - 6000 },
    ]);
    // Two persisted samples feed the series.
    db.dao.metricSamples.insert({
      customer_id: customerId,
      service: SERVICE,
      bucket_ts: now - 15000,
      window_sec: 60,
      request_count: 12,
      error_count: 0,
      error_rate: 0,
      p50_ms: 30,
      p95_ms: 90,
      p99_ms: 120,
    });
    db.dao.metricSamples.insert({
      customer_id: customerId,
      service: SERVICE,
      bucket_ts: now,
      window_sec: 60,
      request_count: 2,
      error_count: 1,
      error_rate: 0.5,
      p50_ms: 40,
      p95_ms: 40,
      p99_ms: 40,
    });
    const snap = buildMetricsSnapshot(db, customerId, {
      service: SERVICE,
      window_sec: 900,
      now,
    });
    expect(snap).not.toBeNull();
    expect(snap!.service).toBe(SERVICE);
    expect(snap!.window_sec).toBe(900);
    expect(snap!.current.req_count).toBe(2); // live window (both recent events)
    expect(snap!.series.length).toBe(2);
    expect(snap!.series[0].ts).toBeLessThan(snap!.series[1].ts); // ascending
    expect(snap!.series.length).toBeLessThanOrEqual(240);
  });

  it('service health carries active_incident_id', () => {
    const now = 3_000_000;
    ingest(SERVICE, [{ status: 200, latency_ms: 20, timestamp: now - 1000 }]);
    const before = buildServiceHealth(
      db,
      customerId,
      db.dao.services.getByName(customerId, SERVICE)!,
      now,
      config,
    );
    expect(before.active_incident_id).toBeNull();
    expect(before.health).toBe('healthy');

    const inc = db.dao.incidents.openOrDedup({
      customer_id: customerId,
      service: SERVICE,
      detector: 'error_rate',
      fingerprint: 'fp1',
      title: 't',
      severity: 'high',
      threshold_value: 0.2,
      observed_value: 0.9,
    }).incident;

    const after = buildServiceHealth(
      db,
      customerId,
      db.dao.services.getByName(customerId, SERVICE)!,
      now,
      config,
    );
    expect(after.active_incident_id).toBe(inc.id);

    const all = buildServicesResponse(db, customerId, now, config);
    expect(all.services.map((s) => s.name)).toContain(SERVICE);
  });
});
