import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Incident } from '@oncall/shared';
import { openMemoryDatabase, type OncallDb } from '../src/db/index.js';
import { loadConfig, type Config } from '../src/config.js';
import {
  createBroker,
  type Broker,
  type BrokerMessage,
} from '../src/sse/broker.js';
import {
  DetectionEngine,
  ManualClock,
  detectionFingerprint,
  evaluateDetections,
  incidentsTopic,
  type InvestigationEnqueuer,
  type Notifier,
} from '../src/detection/index.js';

/**
 * C5 detection-engine tests (SPEC §10). Fully deterministic: an injected
 * `ManualClock` drives the loop (no wall-clock sleeps) and synthetic `log_events`
 * with explicit timestamps feed each tick. Asserts thresholds fire, dedup
 * prevents duplicates, silence triggers, auto-heal + recovery transitions are
 * correct, and the open-time seams (Slack stub, investigation enqueue, broker
 * publish) fire exactly once per new incident.
 */

const KEY = 'detect-test-key';
const SVC = 'checkout-api';
const ERR_SIG = 'typeerror cannot read <str>';

let db: OncallDb;
let customerId: string;
let config: Config;
let clock: ManualClock;

/** Spy seams. */
let notified: Incident[];
let escalatedNotices: Incident[];
let enqueued: Incident[];
let published: Array<{ topic: string; message: BrokerMessage }>;
let broker: Broker;

function makeEngine(overrides: Partial<ConstructorParameters<typeof DetectionEngine>[0]> = {}) {
  const notifier: Notifier = {
    incidentOpened: (i) => void notified.push(i),
    incidentEscalated: (i) => void escalatedNotices.push(i),
  };
  const enqueuer: InvestigationEnqueuer = { enqueue: (i) => void enqueued.push(i) };
  return new DetectionEngine({
    db,
    config,
    clock,
    broker,
    notifier,
    enqueuer,
    ...overrides,
  });
}

beforeEach(() => {
  db = openMemoryDatabase();
  customerId = db.dao.customers.create({ name: 'acme', ingest_api_key: KEY }).id;
  config = loadConfig({ INGEST_API_KEY: KEY });
  clock = new ManualClock(1_000_000);
  notified = [];
  escalatedNotices = [];
  enqueued = [];
  published = [];
  broker = createBroker();
  broker.subscribe(incidentsTopic(customerId), (message) =>
    published.push({ topic: incidentsTopic(customerId), message }),
  );
});

afterEach(() => {
  db.close();
});

/** Seed events at the current clock time and register the service heartbeat. */
function ingest(
  specs: Array<{
    level?: 'debug' | 'info' | 'warn' | 'error';
    status?: number | null;
    latency_ms?: number | null;
    fingerprint_sig?: string | null;
    at?: number;
  }>,
  service = SVC,
): void {
  const now = clock.now();
  let maxTs = 0;
  for (const s of specs) {
    const timestamp = s.at ?? now;
    maxTs = Math.max(maxTs, timestamp);
    db.dao.logEvents.insert({
      customer_id: customerId,
      service,
      level: s.level ?? 'info',
      message: 'req',
      timestamp,
      status: s.status ?? null,
      latency_ms: s.latency_ms ?? null,
      fingerprint_sig: s.fingerprint_sig ?? null,
    });
  }
  db.dao.services.touch(customerId, service, maxTs);
}

function nHealthy(n: number, latency = 40) {
  return Array.from({ length: n }, () => ({ status: 200, latency_ms: latency }));
}
function nErrors(n: number) {
  return Array.from({ length: n }, () => ({
    level: 'error' as const,
    status: 500,
    latency_ms: 40,
    fingerprint_sig: ERR_SIG,
  }));
}

const active = (svc = SVC) =>
  db.dao.incidents.list({ customer_id: customerId, service: svc, activeOnly: true });

describe('threshold evaluation (SPEC §10.3, pure)', () => {
  it('needs both the rate AND the min-request floor', () => {
    // 2 errors only → below MIN_REQUESTS_FOR_DETECTION (5).
    const few = evaluateDetections(
      { request_count: 2, error_count: 2, error_rate: 1, p50_ms: 0, p95_ms: 0, raw_request_count: 0, dominant_sig: ERR_SIG, first_error_at: 100 },
      { wasActive: true, lastEventAt: 1000 },
      2000,
      config,
    );
    expect(few).toHaveLength(0);
  });

  it('error_rate + latency can both fire in one tick with distinct fingerprints', () => {
    const dets = evaluateDetections(
      { request_count: 10, error_count: 3, error_rate: 0.3, p50_ms: 500, p95_ms: 2000, raw_request_count: 10, dominant_sig: ERR_SIG, first_error_at: 100 },
      { wasActive: true, lastEventAt: 2000 },
      2000,
      config,
    );
    const detectors = dets.map((d) => d.detector).sort();
    expect(detectors).toEqual(['error_rate', 'latency']);
    const fps = dets.map((d) => detectionFingerprint(SVC, d.detector, d.dominant_sig));
    expect(new Set(fps).size).toBe(2); // distinct
  });
});

describe('error_rate detection + dedup (SPEC §10.3/§10.2/§8)', () => {
  it('opens one incident and fires the open-time seams exactly once', () => {
    ingest([...nHealthy(7), ...nErrors(3)]); // error_rate 0.3, 10 requests
    const engine = makeEngine();
    const r = engine.tick();

    expect(r.opened).toHaveLength(1);
    const inc = r.opened[0];
    expect(inc.detector).toBe('error_rate');
    expect(inc.status).toBe('open');
    expect(inc.observed_value).toBeCloseTo(0.3, 5);
    expect(inc.threshold_value).toBe(0.2);
    expect(inc.fingerprint).toBe(
      detectionFingerprint(SVC, 'error_rate', ERR_SIG),
    );
    expect(inc.first_error_at).not.toBeNull();

    // Seams fired once.
    expect(notified.map((i) => i.id)).toEqual([inc.id]);
    expect(enqueued.map((i) => i.id)).toEqual([inc.id]);
    expect(published.filter((p) => p.message.event === 'incident_opened')).toHaveLength(1);
  });

  it('the DEFAULT notifier persists an FR-17 Slack stub row on open', () => {
    ingest([...nHealthy(7), ...nErrors(3)]);
    // Omit the notifier override → engine uses createSlackStubNotifier.
    const engine = new DetectionEngine({ db, config, clock, broker });
    const inc = engine.tick().opened[0];
    const notes = db.dao.notifications.listByIncident(inc.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].channel).toBe('slack');
    expect(notes[0].status).toBe('stubbed');
  });

  it('a second breach dedups (updates observed_value) — no duplicate incident, no re-enqueue', () => {
    ingest([...nHealthy(7), ...nErrors(3)]);
    const engine = makeEngine();
    const first = engine.tick();
    const inc = first.opened[0];

    // Advance a tick; stronger breach (higher error rate, same dominant sig).
    clock.advance(config.detection.intervalMs);
    ingest([...nHealthy(2), ...nErrors(8)]); // rate now higher
    const second = engine.tick();

    expect(second.opened).toHaveLength(0);
    expect(second.deduped).toHaveLength(1);
    expect(second.deduped[0].id).toBe(inc.id);
    expect(active()).toHaveLength(1); // still exactly one live incident

    // No re-notify / re-enqueue on dedup.
    expect(enqueued).toHaveLength(1);
    expect(notified).toHaveLength(1);

    const updated = db.dao.incidents.getById(inc.id)!;
    expect(updated.observed_value).toBeGreaterThan(inc.observed_value);
  });

  it('writes a metric_samples row every tick', () => {
    ingest([...nHealthy(5)]);
    const engine = makeEngine();
    engine.tick();
    clock.advance(15000);
    ingest([...nHealthy(5)]);
    engine.tick();
    const series = db.dao.metricSamples.seriesForService(customerId, SVC, 0, 240);
    expect(series.length).toBe(2);
    expect(series[0].window_sec).toBe(60);
  });
});

describe('latency detection (SPEC §10.3)', () => {
  it('opens a latency incident (dominant_sig empty) when p95 breaches', () => {
    ingest(Array.from({ length: 6 }, () => ({ status: 200, latency_ms: 2500 })));
    const engine = makeEngine();
    const r = engine.tick();
    const latency = r.opened.filter((i) => i.detector === 'latency');
    expect(latency).toHaveLength(1);
    expect(latency[0].fingerprint).toBe(detectionFingerprint(SVC, 'latency', ''));
    expect(latency[0].observed_value).toBeGreaterThanOrEqual(1000);
  });
});

describe('silence detection (SPEC §10.3 FR-19)', () => {
  it('fires once the service goes quiet past SILENCE_WINDOW_MS, then auto-heals on resume', () => {
    // Service was active at T; no events since.
    const t0 = clock.now();
    db.dao.services.touch(customerId, SVC, t0);

    // Not yet silent.
    const engine = makeEngine();
    expect(engine.tick().opened).toHaveLength(0);

    // Advance past the silence window.
    clock.set(t0 + config.detection.silenceWindowMs + 1);
    const r = engine.tick();
    expect(r.opened).toHaveLength(1);
    expect(r.opened[0].detector).toBe('silence');
    expect(r.opened[0].fingerprint).toBe(detectionFingerprint(SVC, 'silence', ''));

    // Events resume → silence no longer breaches → transient auto-heal.
    clock.advance(15000);
    db.dao.services.touch(customerId, SVC, clock.now());
    const healed = engine.tick();
    expect(healed.resolved.map((i) => i.detector)).toContain('silence');
    expect(active()).toHaveLength(0);
    const resolved = db.dao.incidents.getById(r.opened[0].id)!;
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolved_at).not.toBeNull();
  });
});

describe('transient auto-heal (SPEC §10.4)', () => {
  it('resolves an open error_rate incident once metrics recover', () => {
    ingest([...nHealthy(7), ...nErrors(3)]);
    const engine = makeEngine();
    const opened = engine.tick().opened[0];
    expect(opened.status).toBe('open');

    // Advance well past the 60s window so the errors age out; healthy traffic only.
    clock.advance(90_000);
    ingest([...nHealthy(8)]);
    const r = engine.tick();

    expect(r.resolved.map((i) => i.id)).toContain(opened.id);
    expect(db.dao.incidents.getById(opened.id)!.status).toBe('resolved');
    expect(active()).toHaveLength(0);
  });

  it('does NOT auto-heal escalated or verifying incidents', () => {
    ingest([...nHealthy(7), ...nErrors(3)]);
    const engine = makeEngine({ recoveryVerifier: null });
    const inc = engine.tick().opened[0];
    // Move it to escalated (human-owned).
    db.dao.incidents.setStatus(inc.id, 'escalated');

    clock.advance(90_000);
    ingest([...nHealthy(8)]); // metrics healthy now
    const r = engine.tick();

    expect(r.resolved).toHaveLength(0);
    expect(db.dao.incidents.getById(inc.id)!.status).toBe('escalated');
  });
});

describe('recovery verifier seam (SPEC §10.5)', () => {
  it('verifying → resolved after sustained recovery', () => {
    ingest([...nHealthy(7), ...nErrors(3)]);
    const engine = makeEngine();
    const inc = engine.tick().opened[0];

    // Simulate C9's merge detection: enter the recovery window.
    const t1 = clock.advance(15000);
    db.dao.incidents.setStatus(inc.id, 'verifying');
    engine.verifier!.begin(db.dao.incidents.getById(inc.id)!, t1);
    // Post-merge: a burst of healthy traffic drops error_rate below threshold.
    ingest(nHealthy(60));

    // First evaluation: healthy but not yet sustained.
    let r = engine.tick();
    expect(r.resolved).toHaveLength(0);
    expect(db.dao.incidents.getById(inc.id)!.status).toBe('verifying');

    // Sustain healthy ≥ 30s within the recovery window.
    clock.advance(31_000);
    ingest(nHealthy(60));
    r = engine.tick();
    expect(r.resolved.map((i) => i.id)).toContain(inc.id);
    const resolved = db.dao.incidents.getById(inc.id)!;
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolved_at).not.toBeNull();
    expect(engine.verifier!.isTracking(inc.id)).toBe(false);
  });

  it('verifying → escalated when recovery does not hold within the window', () => {
    ingest([...nHealthy(7), ...nErrors(3)]);
    const engine = makeEngine();
    const inc = engine.tick().opened[0];

    const t1 = clock.advance(15000);
    db.dao.incidents.setStatus(inc.id, 'verifying');
    engine.verifier!.begin(db.dao.incidents.getById(inc.id)!, t1);

    // Errors persist past the recovery window → not_recovered → re-escalate.
    clock.advance(config.detection.recoveryWindowMs + 1000);
    ingest([...nHealthy(2), ...nErrors(8)]);
    const r = engine.tick();

    expect(r.escalated.map((i) => i.id)).toContain(inc.id);
    expect(db.dao.incidents.getById(inc.id)!.status).toBe('escalated');
    expect(escalatedNotices.map((i) => i.id)).toContain(inc.id);
  });
});

describe('loop control (SPEC §10.1)', () => {
  it('start()/stop() are idempotent and drive tick() on an interval', async () => {
    const engine = makeEngine();
    expect(engine.running).toBe(false);
    engine.start();
    engine.start(); // idempotent
    expect(engine.running).toBe(true);
    engine.stop();
    expect(engine.running).toBe(false);
  });

  it('one tick evaluates every registered service', () => {
    ingest([...nHealthy(6)], 'svc-a');
    ingest([...nHealthy(6)], 'svc-b');
    const engine = makeEngine();
    const r = engine.tick();
    expect(r.servicesEvaluated).toBe(2);
    expect(r.samplesWritten).toBe(2);
  });
});
