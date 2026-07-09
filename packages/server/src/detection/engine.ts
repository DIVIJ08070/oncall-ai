import type { Incident } from '@oncall/shared';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';
import type { ServiceRow } from '../db/rows.js';
import type { Broker } from '../sse/broker.js';
import { rollupWindow, type Rollup } from '../metrics/rollup.js';
import { currentRange, WINDOW_SEC } from '../metrics/windows.js';
import { type Clock, systemClock } from './clock.js';
import { detectionFingerprint } from './fingerprint.js';
import { evaluateDetections, titleForDetection } from './thresholds.js';
import {
  AUTO_HEAL_STATUSES,
  escalateIncident,
  resolveIncident,
} from './lifecycle.js';
import {
  createMetricsRecoveryVerifier,
  type RecoveryVerifier,
} from './recovery.js';
import {
  createNoopEnqueuer,
  createSlackStubNotifier,
  incidentsTopic,
  type DetectionLogger,
  type InvestigationEnqueuer,
  type Notifier,
} from './seams.js';

/**
 * Detection engine (SPEC §10). Each tick, per active service:
 *   1. roll up the trailing 60 s window (`metrics/`) and write a `metric_samples` row;
 *   2. evaluate the error_rate / latency / silence thresholds (§10.3);
 *   3. open (or dedup) an incident per breaching detector via `IncidentsDao.openOrDedup`,
 *      firing the Slack-stub + investigation-enqueue seams on a *new* incident (§10.4);
 *   4. transient auto-heal: resolve pre-PR incidents whose detector no longer breaches;
 *   5. drive `verifying → resolved | escalated` through the recovery verifier (§10.5).
 *
 * Time is read only through an injected `Clock`, so `tick()` is fully
 * deterministic and tests advance the loop without wall-clock sleeps. `start()`
 * schedules `tick()` on a `setInterval` at `DETECTION_INTERVAL_MS`.
 */

export interface DetectionEngineOptions {
  db: OncallDb;
  config: Config;
  clock?: Clock;
  broker?: Broker;
  notifier?: Notifier;
  enqueuer?: InvestigationEnqueuer;
  /** Pass `null` to disable verifier-driven recovery transitions (C9 owns them fully). */
  recoveryVerifier?: RecoveryVerifier | null;
  logger?: DetectionLogger;
}

/** Per-tick summary (returned from `tick()` for tests + observability). */
export interface TickResult {
  now: number;
  servicesEvaluated: number;
  samplesWritten: number;
  opened: Incident[];
  deduped: Incident[];
  resolved: Incident[];
  escalated: Incident[];
}

export class DetectionEngine {
  private readonly db: OncallDb;
  private readonly config: Config;
  private readonly clock: Clock;
  private readonly broker?: Broker;
  private readonly notifier: Notifier;
  private readonly enqueuer: InvestigationEnqueuer;
  private readonly recoveryVerifier: RecoveryVerifier | null;
  private readonly log: DetectionLogger;

  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;

  constructor(opts: DetectionEngineOptions) {
    this.db = opts.db;
    this.config = opts.config;
    this.clock = opts.clock ?? systemClock;
    this.broker = opts.broker;
    this.log = opts.logger ?? (() => {});
    this.notifier = opts.notifier ?? createSlackStubNotifier(this.db, this.config);
    this.enqueuer = opts.enqueuer ?? createNoopEnqueuer(this.log);
    this.recoveryVerifier =
      opts.recoveryVerifier === undefined
        ? createMetricsRecoveryVerifier(this.config)
        : opts.recoveryVerifier;
  }

  /** Expose the recovery verifier so C9's merge poller can `begin()` a window. */
  get verifier(): RecoveryVerifier | null {
    return this.recoveryVerifier;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Start the 15 s (default) detection loop (SPEC §10.1). Idempotent. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.ticking) return; // never overlap ticks
      this.ticking = true;
      try {
        this.tick();
      } catch (err) {
        this.log('[detection] tick error', err);
      } finally {
        this.ticking = false;
      }
    }, this.config.detection.intervalMs);
    // Don't keep the process alive solely for the loop.
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log('[detection] loop started', {
      intervalMs: this.config.detection.intervalMs,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.log('[detection] loop stopped');
    }
  }

  /** Run exactly one detection pass across every customer/service. */
  tick(): TickResult {
    const now = this.clock.now();
    const result: TickResult = {
      now,
      servicesEvaluated: 0,
      samplesWritten: 0,
      opened: [],
      deduped: [],
      resolved: [],
      escalated: [],
    };

    for (const customer of this.db.dao.customers.list()) {
      for (const svc of this.db.dao.services.listByCustomer(customer.id)) {
        result.servicesEvaluated++;
        this.evaluateService(customer.id, svc, now, result);
      }
    }
    return result;
  }

  private evaluateService(
    customerId: string,
    svc: ServiceRow,
    now: number,
    result: TickResult,
  ): void {
    const { from, to } = currentRange(now);
    const rollup = rollupWindow(this.db.raw, customerId, svc.name, from, to);

    // (1) Persist the tick's rollup (SPEC §8 metric_samples, one row per tick).
    this.db.dao.metricSamples.insert({
      customer_id: customerId,
      service: svc.name,
      bucket_ts: now,
      window_sec: WINDOW_SEC,
      request_count: rollup.request_count,
      error_count: rollup.error_count,
      error_rate: rollup.error_rate,
      p50_ms: rollup.p50_ms,
      p95_ms: rollup.p95_ms,
      p99_ms: rollup.p99_ms,
    });
    result.samplesWritten++;

    // (2) Evaluate thresholds.
    const detections = evaluateDetections(
      rollup,
      { wasActive: svc.last_event_at !== null, lastEventAt: svc.last_event_at },
      now,
      this.config,
    );
    const breaching = new Set(detections.map((d) => d.detector));

    // (3) Open / dedup an incident per breaching detector.
    for (const det of detections) {
      const fingerprint = detectionFingerprint(
        svc.name,
        det.detector,
        det.dominant_sig,
      );
      const openRes = this.db.dao.incidents.openOrDedup({
        customer_id: customerId,
        service: svc.name,
        detector: det.detector,
        fingerprint,
        title: titleForDetection(det.detector, svc.name),
        severity: det.severity,
        threshold_value: det.threshold_value,
        observed_value: det.observed_value,
        first_error_at: det.first_error_at,
        detected_at: now,
        opened_at: now,
      });
      if (openRes.deduped) {
        result.deduped.push(openRes.incident);
      } else {
        result.opened.push(openRes.incident);
        this.onIncidentOpened(customerId, openRes.incident);
      }
    }

    // (4)/(5) Lifecycle: auto-heal pre-PR incidents + drive recovery verification.
    const active = this.db.dao.incidents.list({
      customer_id: customerId,
      service: svc.name,
      activeOnly: true,
    });
    for (const inc of active) {
      if (AUTO_HEAL_STATUSES.includes(inc.status) && !breaching.has(inc.detector)) {
        // Transient auto-heal (SPEC §10.4): metrics recovered before any PR.
        const resolved = resolveIncident(this.db.dao.incidents, inc.id, now);
        if (resolved) {
          this.recoveryVerifier?.forget(inc.id);
          result.resolved.push(resolved);
          this.publishLifecycle(customerId, resolved, 'incident_resolved');
          this.log('[detection] incident self-recovered', { id: inc.id });
        }
      } else if (inc.status === 'verifying' && this.recoveryVerifier) {
        this.processVerifying(customerId, inc, now, rollup, result);
      }
    }
  }

  /** Recovery-window evaluation for a `verifying` incident (SPEC §10.5). */
  private processVerifying(
    customerId: string,
    inc: Incident,
    now: number,
    rollup: Rollup,
    result: TickResult,
  ): void {
    const verifier = this.recoveryVerifier;
    if (!verifier) return;
    const outcome = verifier.evaluate(inc, now, rollup);
    if (outcome === 'recovered') {
      const resolved = resolveIncident(this.db.dao.incidents, inc.id, now);
      verifier.forget(inc.id);
      if (resolved) {
        result.resolved.push(resolved);
        this.publishLifecycle(customerId, resolved, 'incident_resolved');
        this.log('[detection] recovery verified', { id: inc.id });
      }
    } else if (outcome === 'not_recovered') {
      const escalated = escalateIncident(this.db.dao.incidents, inc.id);
      verifier.forget(inc.id);
      if (escalated) {
        result.escalated.push(escalated);
        this.publishLifecycle(customerId, escalated, 'incident_escalated');
        void this.notifier.incidentEscalated?.(escalated);
        this.log('[detection] recovery failed → re-escalated', { id: inc.id });
      }
    }
  }

  /** Fire the open-time seams (SPEC §10.4): publish + Slack stub + enqueue. */
  private onIncidentOpened(customerId: string, incident: Incident): void {
    this.publishLifecycle(customerId, incident, 'incident_opened');
    try {
      void this.notifier.incidentOpened(incident);
    } catch (err) {
      this.log('[detection] notifier error', err);
    }
    try {
      void this.enqueuer.enqueue(incident);
    } catch (err) {
      this.log('[detection] enqueue error', err);
    }
  }

  private publishLifecycle(
    customerId: string,
    incident: Incident,
    event: string,
  ): void {
    this.broker?.publish(incidentsTopic(customerId), {
      event,
      data: incident,
    });
  }
}

/** Factory mirroring the other module conventions. */
export function createDetectionEngine(
  opts: DetectionEngineOptions,
): DetectionEngine {
  return new DetectionEngine(opts);
}
