import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Incident, LogLevel } from '@oncall/shared';
import { MetricsSnapshotSchema, ServiceHealthSchema } from '@oncall/shared';
import { openMemoryDatabase, type OncallDb } from '../src/db/index.js';
import { loadConfig, type Config } from '../src/config.js';
import { createBroker, type Broker, type BrokerMessage } from '../src/sse/broker.js';
import {
  computeRollup,
  percentile,
  dominantSignature,
  rollupWindow,
  computeBaseline,
  buildMetricsSnapshot,
  buildServiceHealth,
  buildServicesResponse,
  classifyHealth,
  emptyRollup,
  isRequestEvent,
  isErrorEvent,
  type Rollup,
  type RollupEvent,
} from '../src/metrics/index.js';
import {
  DetectionEngine,
  createDetectionEngine,
  ManualClock,
  evaluateDetections,
  detectionFingerprint,
  createMetricsRecoveryVerifier,
  markInvestigating,
  beginVerifying,
  RECOVERY_SUSTAIN_MS,
  type InvestigationEnqueuer,
  type Notifier,
} from '../src/detection/index.js';

/**
 * QA C5 — INDEPENDENT spec-derived contract suite (SPEC §10 / §7.2 / §8).
 *
 * Written from `features/oncall-ai/qa/TEST_CASES-C5.md`, itself derived from the
 * SPEC before reading the implementation. Every time-dependent case uses the
 * impl's injected `ManualClock` (never wall-clock) and synthetic `log_events`.
 * Not copied from the developer's `detection-engine.test.ts` / `metrics-rollup.test.ts`.
 */

const KEY = 'qa-c5-key';
const SVC = 'checkout-api';
const ERR_SIG = 'typeerror cannot read <str>';

let db: OncallDb;
let customerId: string;
let config: Config;

beforeEach(() => {
  db = openMemoryDatabase();
  customerId = db.dao.customers.create({ name: 'QA C5', ingest_api_key: KEY }).id;
  config = loadConfig({}); // SPEC §14 defaults: 0.2 / 5 / 1000ms / 60000ms / 15000ms / 60000ms
});

afterEach(() => {
  db.close();
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

function seed(
  service: string,
  timestamp: number,
  o: {
    level?: LogLevel;
    status?: number | null;
    latency_ms?: number | null;
    fingerprint_sig?: string | null;
    message?: string;
  } = {},
): void {
  db.dao.logEvents.insert({
    customer_id: customerId,
    service,
    level: o.level ?? 'info',
    message: o.message ?? 'req',
    timestamp,
    status: o.status ?? null,
    latency_ms: o.latency_ms ?? null,
    fingerprint_sig: o.fingerprint_sig ?? null,
  });
}

/** Seed `total` request events at `now`, `errors` of them error(500)+sig, rest info(200). */
function seedErrorRate(now: number, total: number, errors: number, sig = ERR_SIG): void {
  for (let i = 0; i < total - errors; i++) seed(SVC, now, { level: 'info', status: 200, latency_ms: 40 });
  for (let i = 0; i < errors; i++)
    seed(SVC, now, { level: 'error', status: 500, latency_ms: 40, fingerprint_sig: sig });
}

/** Seed `n` request events at `now` all with the given latency (p95 == latency). */
function seedLatency(now: number, n: number, latencyMs: number): void {
  for (let i = 0; i < n; i++) seed(SVC, now, { level: 'info', status: 200, latency_ms: latencyMs });
}

/** Build a Rollup with overrides for pure threshold/verifier tests. */
function mkRollup(o: Partial<Rollup> = {}): Rollup {
  return { ...emptyRollup(), ...o };
}

/** Independent sha1 of the §10.2 fingerprint string (does NOT call the impl helper). */
function sha1Fp(service: string, detector: string, sig: string): string {
  return createHash('sha1').update(`${service}|${detector}|${sig}`).digest('hex');
}

function incidentsFor(service = SVC): Incident[] {
  return db.dao.incidents.list({ customer_id: customerId, service, limit: 200 });
}

/* ═══════════════════════════════════════════════════════════════════════════
   A. Metric rollup + percentiles (§10.2, §7.2 current)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('A. rollup + percentiles (§10.2)', () => {
  it('TC-01: trailing-60s window includes only in-window events', () => {
    const now = 1_000_000_000;
    seed(SVC, now - 10_000, { status: 200, latency_ms: 10 });
    seed(SVC, now - 30_000, { status: 200, latency_ms: 10 });
    seed(SVC, now - 60_000, { status: 200, latency_ms: 10 }); // boundary — inclusive
    seed(SVC, now - 61_000, { status: 200, latency_ms: 10 }); // out
    seed(SVC, now - 120_000, { status: 200, latency_ms: 10 }); // out
    const r = rollupWindow(db.raw, customerId, SVC, now - 60_000, now);
    expect(r.request_count).toBe(3);
  });

  it('TC-02: request_count counts status/latency-bearing events only', () => {
    const r = computeRollup([
      { timestamp: 1, level: 'info', status: 200, latency_ms: 5, fingerprint_sig: null },
      { timestamp: 2, level: 'info', status: 200, latency_ms: 5, fingerprint_sig: null },
      { timestamp: 3, level: 'info', status: 200, latency_ms: 5, fingerprint_sig: null },
      { timestamp: 4, level: 'info', status: 200, latency_ms: 5, fingerprint_sig: null },
      { timestamp: 5, level: 'info', status: 200, latency_ms: 5, fingerprint_sig: null },
      { timestamp: 6, level: 'info', status: null, latency_ms: null, fingerprint_sig: null },
      { timestamp: 7, level: 'debug', status: null, latency_ms: null, fingerprint_sig: null },
    ]);
    expect(r.request_count).toBe(5);
    expect(r.raw_request_count).toBe(5);
  });

  it('TC-03: error_count counts error-level (or status>=500) events', () => {
    const evs: RollupEvent[] = [];
    for (let i = 0; i < 3; i++) evs.push({ timestamp: i, level: 'error', status: 200, latency_ms: 5, fingerprint_sig: 's' });
    for (let i = 0; i < 7; i++) evs.push({ timestamp: 10 + i, level: 'info', status: 200, latency_ms: 5, fingerprint_sig: null });
    const r = computeRollup(evs);
    expect(r.error_count).toBe(3);
    expect(r.request_count).toBe(10);
  });

  it('TC-04: error_rate = error_count / max(request_count,1) = 0.2 at 1/5', () => {
    const r = computeRollup([
      { timestamp: 1, level: 'error', status: 500, latency_ms: 5, fingerprint_sig: 's' },
      { timestamp: 2, level: 'info', status: 200, latency_ms: 5, fingerprint_sig: null },
      { timestamp: 3, level: 'info', status: 200, latency_ms: 5, fingerprint_sig: null },
      { timestamp: 4, level: 'info', status: 200, latency_ms: 5, fingerprint_sig: null },
      { timestamp: 5, level: 'info', status: 200, latency_ms: 5, fingerprint_sig: null },
    ]);
    expect(r.error_count).toBe(1);
    expect(r.request_count).toBe(5);
    expect(r.error_rate).toBeCloseTo(0.2, 9);
  });

  it('TC-05: error_rate stays a finite fraction <=1 (no divide-by-zero) even with error-only events', () => {
    const r = computeRollup([
      { timestamp: 1, level: 'error', status: null, latency_ms: null, fingerprint_sig: 's' },
      { timestamp: 2, level: 'error', status: null, latency_ms: null, fingerprint_sig: 's' },
    ]);
    expect(r.error_count).toBe(2);
    expect(Number.isFinite(r.error_rate)).toBe(true);
    expect(r.error_rate).toBeLessThanOrEqual(1);
    expect(r.error_rate).toBe(2 / Math.max(r.request_count, 1));
  });

  it('TC-06: p50/p95/p99 ordered and at the expected ranks for 1..100', () => {
    const evs: RollupEvent[] = [];
    for (let v = 1; v <= 100; v++) evs.push({ timestamp: v, level: 'info', status: 200, latency_ms: v, fingerprint_sig: null });
    const r = computeRollup(evs);
    expect(r.p50_ms).toBeLessThanOrEqual(r.p95_ms);
    expect(r.p95_ms).toBeLessThanOrEqual(r.p99_ms);
    expect(r.p50_ms).toBeGreaterThanOrEqual(49);
    expect(r.p50_ms).toBeLessThanOrEqual(52);
    expect(r.p95_ms).toBeGreaterThanOrEqual(94);
    expect(r.p95_ms).toBeLessThanOrEqual(96);
    expect(r.p99_ms).toBeGreaterThanOrEqual(98);
    expect(r.p99_ms).toBeLessThanOrEqual(100);
  });

  it('TC-07: percentiles of constant latency equal that value', () => {
    const evs: RollupEvent[] = [];
    for (let i = 0; i < 20; i++) evs.push({ timestamp: i, level: 'info', status: 200, latency_ms: 500, fingerprint_sig: null });
    const r = computeRollup(evs);
    expect([r.p50_ms, r.p95_ms, r.p99_ms]).toEqual([500, 500, 500]);
    // percentile() helper directly
    expect(percentile([500, 500, 500], 95)).toBe(500);
    expect(percentile([], 95)).toBe(0);
  });

  it('TC-08: percentiles drawn only from latency-bearing request events', () => {
    const evs: RollupEvent[] = [];
    for (let i = 0; i < 20; i++) evs.push({ timestamp: i, level: 'info', status: 200, latency_ms: 500, fingerprint_sig: null });
    for (let i = 0; i < 5; i++) evs.push({ timestamp: 100 + i, level: 'error', status: null, latency_ms: null, fingerprint_sig: 's' });
    const r = computeRollup(evs);
    expect(r.p95_ms).toBe(500);
  });

  it('classification predicates behave per §10.2', () => {
    expect(isRequestEvent({ timestamp: 0, level: 'info', status: 200, latency_ms: null, fingerprint_sig: null })).toBe(true);
    expect(isRequestEvent({ timestamp: 0, level: 'info', status: null, latency_ms: 12, fingerprint_sig: null })).toBe(true);
    expect(isRequestEvent({ timestamp: 0, level: 'info', status: null, latency_ms: null, fingerprint_sig: null })).toBe(false);
    expect(isErrorEvent({ timestamp: 0, level: 'error', status: null, latency_ms: null, fingerprint_sig: null })).toBe(true);
    expect(isErrorEvent({ timestamp: 0, level: 'info', status: 503, latency_ms: null, fingerprint_sig: null })).toBe(true);
    expect(isErrorEvent({ timestamp: 0, level: 'info', status: 200, latency_ms: null, fingerprint_sig: null })).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B. Baseline (§10.2: trailing 5min excluding last 60s)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('B. baseline (§10.2)', () => {
  it('TC-09: baseline reflects [now-300s, now-60s); current reflects last 60s', () => {
    const now = 2_000_000_000;
    // Older window: high error rate + high latency (10 req, 5 errors, latency 1500).
    for (let i = 0; i < 5; i++) seed(SVC, now - 120_000 + i, { level: 'info', status: 200, latency_ms: 1500 });
    for (let i = 0; i < 5; i++) seed(SVC, now - 120_000 + 50 + i, { level: 'error', status: 500, latency_ms: 1500, fingerprint_sig: ERR_SIG });
    // Last 60s: clean traffic (10 req, 0 errors, latency 40).
    for (let i = 0; i < 10; i++) seed(SVC, now - 10_000 + i, { level: 'info', status: 200, latency_ms: 40 });

    const baseline = computeBaseline(db.raw, customerId, SVC, now);
    const current = rollupWindow(db.raw, customerId, SVC, now - 60_000, now);
    expect(baseline.error_rate).toBeCloseTo(0.5, 6);
    expect(baseline.p95_ms).toBe(1500);
    expect(current.error_rate).toBe(0);
    expect(current.p95_ms).toBe(40);
  });

  it('TC-10: a last-60s spike does NOT pollute the baseline', () => {
    const now = 2_100_000_000;
    for (let i = 0; i < 10; i++) seed(SVC, now - 5_000 + i, { level: 'error', status: 500, latency_ms: 40, fingerprint_sig: ERR_SIG });
    const baseline = computeBaseline(db.raw, customerId, SVC, now);
    expect(baseline.error_rate).toBe(0); // last-60s errors excluded
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C. Threshold: error_rate (§10.3 — >=0.2 AND req>=5)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('C. error_rate threshold (§10.3)', () => {
  const silenceOff = { wasActive: false, lastEventAt: null };

  it('TC-11: fires at boundary error_rate = 0.20 exactly (req>=5)', () => {
    const d = evaluateDetections(mkRollup({ request_count: 5, error_count: 1, error_rate: 0.2 }), silenceOff, 0, config);
    expect(d.map((x) => x.detector)).toContain('error_rate');
  });

  it('TC-12: does NOT fire just below (0.19)', () => {
    const d = evaluateDetections(mkRollup({ request_count: 100, error_count: 19, error_rate: 0.19 }), silenceOff, 0, config);
    expect(d.map((x) => x.detector)).not.toContain('error_rate');
  });

  it('TC-13: noise floor — req below MIN_REQUESTS_FOR_DETECTION does NOT fire', () => {
    const d = evaluateDetections(mkRollup({ request_count: 4, error_count: 4, error_rate: 1.0 }), silenceOff, 0, config);
    expect(d).toHaveLength(0);
  });

  it('TC-14: fires at request_count boundary = 5', () => {
    const d = evaluateDetections(mkRollup({ request_count: 5, error_count: 5, error_rate: 1.0 }), silenceOff, 0, config);
    expect(d.map((x) => x.detector)).toContain('error_rate');
  });

  it('TC-15: healthy traffic → no incident', () => {
    const d = evaluateDetections(mkRollup({ request_count: 50, error_count: 0, error_rate: 0 }), silenceOff, 0, config);
    expect(d).toHaveLength(0);
  });

  it('TC-11e2e: engine.tick opens an error_rate incident from synthetic logs', () => {
    const clock = new ManualClock(5_000_000_000);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    db.dao.services.touch(customerId, SVC, clock.now());
    seedErrorRate(clock.now(), 100, 30); // rate 0.30
    const res = engine.tick();
    expect(res.opened).toHaveLength(1);
    expect(res.opened[0].detector).toBe('error_rate');
    expect(res.opened[0].status).toBe('open');
    expect(res.opened[0].observed_value).toBeCloseTo(0.3, 6);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D. Threshold: latency (§10.3 — p95>=1000 AND req>=5)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('D. latency threshold (§10.3)', () => {
  const silenceOff = { wasActive: false, lastEventAt: null };

  it('TC-16: fires when p95 >= 1000 (req>=5)', () => {
    const d = evaluateDetections(mkRollup({ request_count: 20, error_count: 0, p95_ms: 1200 }), silenceOff, 0, config);
    expect(d.map((x) => x.detector)).toContain('latency');
  });

  it('TC-17: fires at p95 boundary = 1000 exactly', () => {
    const d = evaluateDetections(mkRollup({ request_count: 20, p95_ms: 1000 }), silenceOff, 0, config);
    expect(d.map((x) => x.detector)).toContain('latency');
  });

  it('TC-18: does NOT fire p95 < 1000', () => {
    const d = evaluateDetections(mkRollup({ request_count: 20, p95_ms: 800 }), silenceOff, 0, config);
    expect(d.map((x) => x.detector)).not.toContain('latency');
  });

  it('TC-19: latency noise floor — req<5 does NOT fire', () => {
    const d = evaluateDetections(mkRollup({ request_count: 4, p95_ms: 5000 }), silenceOff, 0, config);
    expect(d).toHaveLength(0);
  });

  it('TC-16e2e: engine.tick opens a latency incident from synthetic logs', () => {
    const clock = new ManualClock(5_100_000_000);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    db.dao.services.touch(customerId, SVC, clock.now());
    seedLatency(clock.now(), 20, 1500);
    const res = engine.tick();
    expect(res.opened).toHaveLength(1);
    expect(res.opened[0].detector).toBe('latency');
  });

  it('TC-20: error_rate + latency co-fire independently (two incidents)', () => {
    const clock = new ManualClock(5_200_000_000);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    db.dao.services.touch(customerId, SVC, clock.now());
    // 20 requests all latency 1500; 10 of them errors → rate 0.5, p95 1500.
    for (let i = 0; i < 10; i++) seed(SVC, clock.now(), { level: 'info', status: 200, latency_ms: 1500 });
    for (let i = 0; i < 10; i++) seed(SVC, clock.now(), { level: 'error', status: 500, latency_ms: 1500, fingerprint_sig: ERR_SIG });
    const res = engine.tick();
    const detectors = res.opened.map((i) => i.detector).sort();
    expect(detectors).toEqual(['error_rate', 'latency']);
    // TC-29: distinct fingerprints for distinct detectors.
    expect(res.opened[0].fingerprint).not.toBe(res.opened[1].fingerprint);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E. Threshold: silence (§10.3 / FR-19)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('E. silence threshold (§10.3, FR-19)', () => {
  const emptyR = mkRollup();

  it('TC-21: fires when now - last_event_at >= 60000 (was active)', () => {
    const now = 100_000_000;
    const d = evaluateDetections(emptyR, { wasActive: true, lastEventAt: now - 60_000 }, now, config);
    expect(d.map((x) => x.detector)).toContain('silence');
  });

  it('TC-22: does NOT fire just below (gap 59999)', () => {
    const now = 100_000_000;
    const d = evaluateDetections(emptyR, { wasActive: true, lastEventAt: now - 59_999 }, now, config);
    expect(d.map((x) => x.detector)).not.toContain('silence');
  });

  it('TC-23: never-active service does not silence', () => {
    const d = evaluateDetections(emptyR, { wasActive: false, lastEventAt: null }, 100_000_000, config);
    expect(d.map((x) => x.detector)).not.toContain('silence');
  });

  it('TC-21e2e: engine opens a silence incident after the window', () => {
    const start = 6_000_000_000;
    const clock = new ManualClock(start);
    db.dao.services.touch(customerId, SVC, start); // last_event_at = start
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    clock.set(start + 60_000); // advance to exactly the window boundary
    const res = engine.tick();
    expect(res.opened).toHaveLength(1);
    expect(res.opened[0].detector).toBe('silence');
    expect(sha1Fp(SVC, 'silence', '')).toBe(res.opened[0].fingerprint); // TC-26 silence fp
  });

  it('TC-24: silence auto-heals when events resume', () => {
    const start = 6_100_000_000;
    const clock = new ManualClock(start);
    db.dao.services.touch(customerId, SVC, start);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    clock.set(start + 60_000);
    engine.tick(); // opens silence incident
    expect(incidentsFor().filter((i) => i.detector === 'silence' && i.status === 'open')).toHaveLength(1);
    // events resume: advance last_event_at to "now"
    db.dao.services.touch(customerId, SVC, clock.now());
    const res = engine.tick();
    expect(res.resolved.map((i) => i.detector)).toContain('silence');
    const inc = incidentsFor().find((i) => i.detector === 'silence')!;
    expect(inc.status).toBe('resolved');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F. Fingerprint + dedup (§10.2 sha1; §8 dedup; FR-05)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('F. fingerprint + dedup (§10.2, §8)', () => {
  it('TC-25: incident.fingerprint == sha1(service|error_rate|dominant_sig)', () => {
    const clock = new ManualClock(7_000_000_000);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    db.dao.services.touch(customerId, SVC, clock.now());
    seedErrorRate(clock.now(), 100, 30, ERR_SIG);
    const res = engine.tick();
    expect(res.opened[0].fingerprint).toBe(sha1Fp(SVC, 'error_rate', ERR_SIG));
    // detectionFingerprint helper agrees with the independent sha1.
    expect(detectionFingerprint(SVC, 'error_rate', ERR_SIG)).toBe(sha1Fp(SVC, 'error_rate', ERR_SIG));
  });

  it('TC-26: latency dominant_sig == "" → sha1(service|latency|)', () => {
    const clock = new ManualClock(7_050_000_000);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    db.dao.services.touch(customerId, SVC, clock.now());
    seedLatency(clock.now(), 20, 1500);
    const res = engine.tick();
    expect(res.opened[0].fingerprint).toBe(sha1Fp(SVC, 'latency', ''));
  });

  it('TC-27: one ongoing failure → ONE incident (dedup updates observed, no duplicate)', () => {
    const clock = new ManualClock(7_100_000_000);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    db.dao.services.touch(customerId, SVC, clock.now());

    seedErrorRate(clock.now(), 100, 30); // rate 0.30
    const r1 = engine.tick();
    expect(r1.opened).toHaveLength(1);

    // +15s: tick-1's error events are still inside the trailing-60s window (a
    // sliding window per §10.2), so the combined rollup is 70/200 = 0.35. The
    // point of the case: the SAME fingerprint dedups instead of duplicating.
    clock.advance(15_000);
    db.dao.services.touch(customerId, SVC, clock.now());
    seedErrorRate(clock.now(), 100, 40); // same fingerprint
    const r2 = engine.tick();
    expect(r2.opened).toHaveLength(0);
    expect(r2.deduped).toHaveLength(1);

    const errIncidents = incidentsFor().filter((i) => i.detector === 'error_rate');
    expect(errIncidents).toHaveLength(1); // exactly ONE incident for the ongoing failure
    expect(errIncidents[0].observed_value).toBeCloseTo(0.35, 6); // observed advanced 0.30 → 0.35
  });

  it('TC-28: dedup does NOT re-fire the open-time seams (enqueue / Slack / broker once)', () => {
    const clock = new ManualClock(7_200_000_000);
    const broker: Broker = createBroker();
    const opened: BrokerMessage[] = [];
    broker.subscribe(`incidents/${customerId}`, (m) => {
      if (m.event === 'incident_opened') opened.push(m);
    });
    let enqueued = 0;
    const enqueuer: InvestigationEnqueuer = { enqueue: () => { enqueued++; } };

    const engine = createDetectionEngine({ db, config, clock, broker, enqueuer, recoveryVerifier: null });
    db.dao.services.touch(customerId, SVC, clock.now());

    seedErrorRate(clock.now(), 100, 30);
    engine.tick(); // open

    clock.advance(15_000);
    db.dao.services.touch(customerId, SVC, clock.now());
    seedErrorRate(clock.now(), 100, 30);
    engine.tick(); // dedup

    const inc = incidentsFor().find((i) => i.detector === 'error_rate')!;
    expect(enqueued).toBe(1);
    expect(opened).toHaveLength(1);
    // Slack stub → exactly one 'stubbed' notifications row (FR-17).
    const stubs = db.dao.notifications.listByIncident(inc.id).filter((n) => n.status === 'stubbed');
    expect(stubs).toHaveLength(1);
    expect(stubs[0].channel).toBe('slack');
  });

  it('TC-30: dominantSignature = most frequent fingerprint_sig; ties broken deterministically', () => {
    const evs = (sigs: string[]): RollupEvent[] =>
      sigs.map((s, i) => ({ timestamp: i, level: 'error' as LogLevel, status: 500, latency_ms: 1, fingerprint_sig: s }));
    expect(dominantSignature(evs(['a', 'a', 'b']))).toBe('a');
    expect(dominantSignature(evs(['b', 'b', 'a', 'a']))).toBe('a'); // tie → lexical
    expect(dominantSignature(evs([]))).toBe('');
    // empty sigs ignored
    expect(dominantSignature(evs(['', '', 'z']))).toBe('z');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   G. Lifecycle state machine (§10.4)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('G. lifecycle (§10.4)', () => {
  it('TC-31: on open the incident is `open` and the three seams fire once', () => {
    const clock = new ManualClock(8_000_000_000);
    const broker = createBroker();
    const events: BrokerMessage[] = [];
    broker.subscribe(`incidents/${customerId}`, (m) => events.push(m));
    let enqueued = 0;
    const engine = createDetectionEngine({
      db, config, clock, broker,
      enqueuer: { enqueue: () => { enqueued++; } },
      recoveryVerifier: null,
    });
    db.dao.services.touch(customerId, SVC, clock.now());
    seedErrorRate(clock.now(), 100, 30);
    const res = engine.tick();
    const inc = res.opened[0];
    expect(inc.status).toBe('open');
    expect(events.filter((e) => e.event === 'incident_opened')).toHaveLength(1);
    expect(enqueued).toBe(1);
    expect(db.dao.notifications.listByIncident(inc.id)).toHaveLength(1);
  });

  it('TC-32: markInvestigating transitions open → investigating', () => {
    const clock = new ManualClock(8_100_000_000);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    db.dao.services.touch(customerId, SVC, clock.now());
    seedErrorRate(clock.now(), 100, 30);
    const inc = engine.tick().opened[0];
    const updated = markInvestigating(db.dao.incidents, inc.id);
    expect(updated?.status).toBe('investigating');
  });

  it('TC-33: transient auto-heal — metrics recover before a PR → resolved', () => {
    const clock = new ManualClock(8_200_000_000);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    db.dao.services.touch(customerId, SVC, clock.now());
    seedErrorRate(clock.now(), 100, 30);
    const inc = engine.tick().opened[0];
    expect(inc.status).toBe('open');

    // Advance past the 60s window so the breaching events age out, then only
    // healthy traffic remains → the detector no longer breaches → auto-heal.
    clock.advance(61_000);
    db.dao.services.touch(customerId, SVC, clock.now());
    seedLatency(clock.now(), 50, 40); // healthy: 50 req, 0 errors, fast
    const res = engine.tick();
    expect(res.resolved.map((i) => i.id)).toContain(inc.id);
    const after = db.dao.incidents.getById(inc.id)!;
    expect(after.status).toBe('resolved');
    expect(after.resolved_at).toBe(clock.now());
  });

  it('TC-34: a resolved incident is terminal — a clean tick neither reopens nor mutates it', () => {
    const clock = new ManualClock(8_300_000_000);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    db.dao.services.touch(customerId, SVC, clock.now());
    seedErrorRate(clock.now(), 100, 30);
    const inc = engine.tick().opened[0];
    clock.advance(61_000); // age the breach out of the window
    db.dao.services.touch(customerId, SVC, clock.now());
    seedLatency(clock.now(), 50, 40);
    engine.tick(); // resolves
    clock.advance(61_000);
    db.dao.services.touch(customerId, SVC, clock.now());
    seedLatency(clock.now(), 50, 40);
    const res = engine.tick(); // clean tick
    expect(res.opened).toHaveLength(0);
    expect(res.resolved).toHaveLength(0);
    expect(incidentsFor()).toHaveLength(1);
    expect(db.dao.incidents.getById(inc.id)!.status).toBe('resolved');
  });

  it('TC-35: one metric_samples row per active service per tick with correct columns', () => {
    const clock = new ManualClock(8_400_000_000);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    db.dao.services.touch(customerId, SVC, clock.now());
    for (let t = 0; t < 3; t++) {
      db.dao.services.touch(customerId, SVC, clock.now());
      seedErrorRate(clock.now(), 100, 30);
      engine.tick();
      clock.advance(15_000);
    }
    const samples = db.dao.metricSamples.seriesForService(customerId, SVC, 0, 240);
    expect(samples).toHaveLength(3); // one row per tick per active service
    // The FIRST tick's window saw only its own batch (later ticks legitimately
    // overlap the sliding 60s window, so assert the isolated first sample).
    const s = samples[0];
    expect(s.window_sec).toBe(60);
    expect(s.bucket_ts).toBe(8_400_000_000); // tick-0 clock time
    expect(s.request_count).toBe(100);
    expect(s.error_count).toBe(30);
    expect(s.error_rate).toBeCloseTo(0.3, 6);
    expect(Number.isInteger(s.p50_ms)).toBe(true);
    expect(Number.isInteger(s.p95_ms)).toBe(true);
    expect(Number.isInteger(s.p99_ms)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   H. Recovery verifier seam (§10.5)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('H. recovery verifier (§10.5)', () => {
  const incident = (detector: 'error_rate' | 'latency' | 'silence' = 'error_rate'): Incident =>
    ({ id: 'inc_verify', detector } as unknown as Incident);
  const healthy = mkRollup({ request_count: 50, error_rate: 0, p95_ms: 40, raw_request_count: 50 });
  const breaching = mkRollup({ request_count: 100, error_count: 50, error_rate: 0.5, p95_ms: 1500 });

  it('TC-36: verifying → recovered on sustained healthy >= 30s', () => {
    const v = createMetricsRecoveryVerifier(config);
    const inc = incident();
    v.begin(inc, 0);
    expect(v.evaluate(inc, 0, healthy)).toBe('pending');
    expect(v.evaluate(inc, RECOVERY_SUSTAIN_MS - 1, healthy)).toBe('pending');
    expect(v.evaluate(inc, RECOVERY_SUSTAIN_MS, healthy)).toBe('recovered');
  });

  it('TC-37: verifying → not_recovered at RECOVERY_WINDOW_MS with no sustained recovery', () => {
    const v = createMetricsRecoveryVerifier(config);
    const inc = incident();
    v.begin(inc, 0);
    expect(v.evaluate(inc, 0, breaching)).toBe('pending');
    expect(v.evaluate(inc, config.detection.recoveryWindowMs - 1, breaching)).toBe('pending');
    expect(v.evaluate(inc, config.detection.recoveryWindowMs, breaching)).toBe('not_recovered');
  });

  it('TC-38: recovery must be SUSTAINED — a relapse resets the clock', () => {
    const v = createMetricsRecoveryVerifier(config);
    const inc = incident();
    v.begin(inc, 0);
    expect(v.evaluate(inc, 0, healthy)).toBe('pending'); // firstHealthy = 0
    expect(v.evaluate(inc, 10_000, breaching)).toBe('pending'); // relapse → reset
    // only 20s of health since the relapse (< 30s) even though 40s elapsed overall
    expect(v.evaluate(inc, 20_000, healthy)).toBe('pending'); // firstHealthy = 20000
    expect(v.evaluate(inc, 40_000, healthy)).toBe('pending'); // 20s sustained < 30s
  });

  it('silence recovers when request volume resumes', () => {
    const v = createMetricsRecoveryVerifier(config);
    const inc = incident('silence');
    v.begin(inc, 0);
    // no volume yet → not healthy
    expect(v.evaluate(inc, 0, mkRollup({ raw_request_count: 0 }))).toBe('pending');
    // volume resumes, sustained ≥30s → recovered
    v.begin(inc, 0);
    expect(v.evaluate(inc, 0, mkRollup({ raw_request_count: 5 }))).toBe('pending');
    expect(v.evaluate(inc, RECOVERY_SUSTAIN_MS, mkRollup({ raw_request_count: 5 }))).toBe('recovered');
  });

  it('TC-36e2e: engine drives a verifying incident → resolved on sustained recovery', () => {
    const t0 = 9_000_000_000;
    const clock = new ManualClock(t0);
    const engine = createDetectionEngine({ db, config, clock });
    db.dao.services.touch(customerId, SVC, clock.now());
    // Create an incident and move it into `verifying`.
    const open = db.dao.incidents.openOrDedup({
      customer_id: customerId, service: SVC, detector: 'error_rate',
      fingerprint: detectionFingerprint(SVC, 'error_rate', ERR_SIG),
      title: 'x', severity: 'high', threshold_value: 0.2, observed_value: 0.5,
    });
    beginVerifying(db.dao.incidents, open.incident.id);
    engine.verifier!.begin(db.dao.incidents.getById(open.incident.id)!, clock.now());

    // Tick 1 (healthy) → still verifying.
    db.dao.services.touch(customerId, SVC, clock.now());
    seedLatency(clock.now(), 20, 40);
    engine.tick();
    expect(db.dao.incidents.getById(open.incident.id)!.status).toBe('verifying');

    // Tick 2, +30s (healthy) → recovered → resolved.
    clock.advance(RECOVERY_SUSTAIN_MS);
    db.dao.services.touch(customerId, SVC, clock.now());
    seedLatency(clock.now(), 20, 40);
    const res = engine.tick();
    expect(res.resolved.map((i) => i.id)).toContain(open.incident.id);
    expect(db.dao.incidents.getById(open.incident.id)!.status).toBe('resolved');
  });

  it('TC-37e2e: engine escalates a verifying incident that never recovers within the window', () => {
    const t0 = 9_100_000_000;
    const clock = new ManualClock(t0);
    const engine = createDetectionEngine({ db, config, clock });
    db.dao.services.touch(customerId, SVC, clock.now());
    const fp = detectionFingerprint(SVC, 'error_rate', ERR_SIG);
    const open = db.dao.incidents.openOrDedup({
      customer_id: customerId, service: SVC, detector: 'error_rate',
      fingerprint: fp, title: 'x', severity: 'high', threshold_value: 0.2, observed_value: 0.5,
    });
    beginVerifying(db.dao.incidents, open.incident.id);
    engine.verifier!.begin(db.dao.incidents.getById(open.incident.id)!, clock.now());

    // Keep breaching across the full recovery window (same fingerprint → dedup, no dup).
    for (const dt of [0, 30_000, config.detection.recoveryWindowMs]) {
      clock.set(t0 + dt);
      db.dao.services.touch(customerId, SVC, clock.now());
      seedErrorRate(clock.now(), 100, 50, ERR_SIG); // rate 0.5
      engine.tick();
    }
    expect(db.dao.incidents.getById(open.incident.id)!.status).toBe('escalated');
    // Still exactly one incident for this fingerprint (dedup held).
    expect(incidentsFor().filter((i) => i.fingerprint === fp)).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   I. DTO builders (§7.2)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('I. DTO builders (§7.2)', () => {
  it('TC-39: buildMetricsSnapshot matches the §7.2 MetricsSnapshot shape', () => {
    const now = 10_000_000_000;
    db.dao.services.touch(customerId, SVC, now);
    seedLatency(now - 1000, 20, 120);
    const snap = buildMetricsSnapshot(db, customerId, { service: SVC, now });
    expect(snap).not.toBeNull();
    expect(() => MetricsSnapshotSchema.parse(snap)).not.toThrow();
    expect(snap!.service).toBe(SVC);
    expect(snap!.window_sec).toBe(900); // §7.2 default
    expect(snap!.resolution_sec).toBe(60);
    expect(snap!.current.req_count).toBe(20);
    expect(snap!.baseline).toHaveProperty('error_rate');
    expect(snap!.baseline).toHaveProperty('p95_ms');
  });

  it('TC-40: metrics series is capped to 240 points', () => {
    const now = 10_100_000_000;
    db.dao.services.touch(customerId, SVC, now);
    for (let i = 0; i < 250; i++) {
      db.dao.metricSamples.insert({
        customer_id: customerId, service: SVC, bucket_ts: now - i * 1000, window_sec: 60,
        request_count: 1, error_count: 0, error_rate: 0, p50_ms: 1, p95_ms: 1, p99_ms: 1,
      });
    }
    const snap = buildMetricsSnapshot(db, customerId, { service: SVC, now, window_sec: 100_000 });
    expect(snap!.series.length).toBeLessThanOrEqual(240);
    expect(snap!.series.length).toBe(240);
  });

  it('TC-41: unknown service → null (C10 maps to 404)', () => {
    expect(buildMetricsSnapshot(db, customerId, { service: 'does-not-exist', now: 1 })).toBeNull();
  });

  it('TC-42/43: buildServicesResponse shape + healthy classification', () => {
    const now = 10_200_000_000;
    db.dao.services.touch(customerId, SVC, now);
    seedLatency(now - 1000, 30, 50); // clean, fast
    const resp = buildServicesResponse(db, customerId, now, config);
    expect(resp.services).toHaveLength(1);
    const entry = resp.services[0];
    expect(() => ServiceHealthSchema.parse(entry)).not.toThrow();
    expect(entry.health).toBe('healthy');
    expect(entry.active_incident_id).toBeNull();
    expect(entry.name).toBe(SVC);
  });

  it('TC-44: active_incident_id populated + non-healthy when an incident is active', () => {
    const now = 10_300_000_000;
    const clock = new ManualClock(now);
    db.dao.services.touch(customerId, SVC, now);
    seedErrorRate(now, 100, 30);
    const engine = createDetectionEngine({ db, config, clock, recoveryVerifier: null });
    const inc = engine.tick().opened[0];
    const svc = db.dao.services.getByName(customerId, SVC)!;
    const health = buildServiceHealth(db, customerId, svc, now, config);
    expect(health.active_incident_id).toBe(inc.id);
    expect(health.health).toBe('down'); // error_rate breach → down
  });

  it('TC-45: health = silent when the service passed the silence window', () => {
    const now = 10_400_000_000;
    db.dao.services.touch(customerId, SVC, now - 60_000); // last_event_at one window ago
    const svc = db.dao.services.getByName(customerId, SVC)!;
    expect(classifyHealth(mkRollup(), svc.last_event_at, now, config)).toBe('silent');
    expect(buildServiceHealth(db, customerId, svc, now, config).health).toBe('silent');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §10.1 loop cadence — injected clock + fake timers (no wall-clock)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('§10.1 loop: start()/stop() drive tick() on DETECTION_INTERVAL_MS', () => {
  it('start schedules ticks; stop halts them (fake timers, injected clock)', () => {
    vi.useFakeTimers();
    try {
      const clock = new ManualClock(11_000_000_000);
      const engine = new DetectionEngine({ db, config, clock, recoveryVerifier: null });
      db.dao.services.touch(customerId, SVC, clock.now());
      expect(engine.running).toBe(false);
      engine.start();
      expect(engine.running).toBe(true);

      vi.advanceTimersByTime(config.detection.intervalMs); // one interval → one tick
      const afterFirst = db.dao.metricSamples.seriesForService(customerId, SVC, 0, 240).length;
      expect(afterFirst).toBeGreaterThanOrEqual(1);

      engine.stop();
      expect(engine.running).toBe(false);
      vi.advanceTimersByTime(config.detection.intervalMs * 3); // no further ticks
      const afterStop = db.dao.metricSamples.seriesForService(customerId, SVC, 0, 240).length;
      expect(afterStop).toBe(afterFirst);
    } finally {
      vi.useRealTimers();
    }
  });
});
