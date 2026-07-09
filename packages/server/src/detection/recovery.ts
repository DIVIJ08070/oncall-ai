import type { Incident } from '@oncall/shared';
import type { Config } from '../config.js';
import type { Rollup } from '../metrics/rollup.js';

/**
 * Recovery-verification seam (SPEC §10.5, FR-12). The merge poller + local heal +
 * PR comment land in **C9**; C5 exposes the verifier state machine so the
 * detection loop can drive `verifying → resolved | escalated` from live metrics.
 *
 * Semantics (SPEC §10.5): once an incident enters `verifying`, sample metrics over
 * a `RECOVERY_WINDOW_MS` window; if recovery holds for a sustained ≥ 30 s the
 * incident is **recovered**, else at window expiry it is **not_recovered**.
 *   - error_rate/latency incidents recover when `error_rate < ERROR_RATE_THRESHOLD`
 *     AND `p95_ms < LATENCY_P95_THRESHOLD_MS`.
 *   - silence incidents recover when events resume (request volume > 0).
 */

export type RecoveryOutcome = 'recovered' | 'not_recovered' | 'pending';

/** Sustained-health window required to confirm recovery (SPEC §10.5 "≥ 30s"). */
export const RECOVERY_SUSTAIN_MS = 30_000;

export interface RecoveryVerifier {
  /** Start (or restart) the recovery window for an incident (C9 merge poller). */
  begin(incident: Incident, now: number): void;
  /** Evaluate this tick's rollup against the recovery window. */
  evaluate(incident: Incident, now: number, rollup: Rollup): RecoveryOutcome;
  /** Drop tracking state once terminal. */
  forget(incidentId: string): void;
  isTracking(incidentId: string): boolean;
}

interface RecoveryState {
  windowStart: number;
  firstHealthyAt: number | null;
}

/**
 * Default metrics-driven verifier. Tracks per-incident recovery-window state in
 * memory. If `begin` was never called (e.g. C9 has not wired the poller yet), the
 * window lazily starts the first time an incident is seen in `verifying`.
 */
export function createMetricsRecoveryVerifier(config: Config): RecoveryVerifier {
  const d = config.detection;
  const state = new Map<string, RecoveryState>();

  const isHealthy = (incident: Incident, rollup: Rollup): boolean => {
    if (incident.detector === 'silence') return rollup.raw_request_count > 0;
    return (
      rollup.error_rate < d.errorRateThreshold &&
      rollup.p95_ms < d.latencyP95ThresholdMs
    );
  };

  return {
    begin(incident, now) {
      state.set(incident.id, { windowStart: now, firstHealthyAt: null });
    },
    isTracking(incidentId) {
      return state.has(incidentId);
    },
    forget(incidentId) {
      state.delete(incidentId);
    },
    evaluate(incident, now, rollup) {
      let s = state.get(incident.id);
      if (!s) {
        s = { windowStart: now, firstHealthyAt: null };
        state.set(incident.id, s);
      }

      if (isHealthy(incident, rollup)) {
        if (s.firstHealthyAt === null) s.firstHealthyAt = now;
        if (now - s.firstHealthyAt >= RECOVERY_SUSTAIN_MS) return 'recovered';
      } else {
        // A relapse resets the sustained-health clock.
        s.firstHealthyAt = null;
      }

      if (now - s.windowStart >= d.recoveryWindowMs) return 'not_recovered';
      return 'pending';
    },
  };
}
