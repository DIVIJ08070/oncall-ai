import type { Detector, Severity } from '@oncall/shared';
import type { Config } from '../config.js';
import type { Rollup } from '../metrics/rollup.js';

/**
 * Threshold evaluation (SPEC §10.3). Pure: given a window rollup, a service's
 * silence state, and the configured thresholds, return every detector that is
 * currently breaching. The detectors are independent, so a single tick can open
 * both an `error_rate` and a `latency` incident (they carry distinct
 * fingerprints). `silence` and `error_rate` are mutually exclusive by
 * construction (silence means no events; error_rate needs request volume).
 *
 * Defaults (SPEC §14): `ERROR_RATE_THRESHOLD=0.2`, `MIN_REQUESTS_FOR_DETECTION=5`,
 * `LATENCY_P95_THRESHOLD_MS=1000`, `SILENCE_WINDOW_MS=60000`.
 */

/** Silence-detector inputs derived from the `services` heartbeat row (§8/§10.3). */
export interface SilenceInput {
  /** Whether the service has ever reported (has a `last_event_at`). */
  wasActive: boolean;
  lastEventAt: number | null;
}

/** One breaching detector for a service on a given tick. */
export interface Detection {
  detector: Detector;
  observed_value: number;
  threshold_value: number;
  severity: Severity;
  /** Dominant error signature (error_rate only; `""` for latency/silence). */
  dominant_sig: string;
  /** Earliest error timestamp in the window (error_rate only; else `null`). */
  first_error_at: number | null;
}

function errorRateSeverity(rate: number, threshold: number): Severity {
  if (rate >= Math.max(0.5, threshold * 2)) return 'high';
  if (rate >= threshold * 1.5) return 'medium';
  return 'low';
}

function latencySeverity(p95: number, threshold: number): Severity {
  if (p95 >= threshold * 2) return 'high';
  if (p95 >= threshold * 1.5) return 'medium';
  return 'low';
}

/** Human-readable incident title per detector (SPEC §7.3 examples). */
export function titleForDetection(detector: Detector, service: string): string {
  switch (detector) {
    case 'error_rate':
      return `Error-rate spike on ${service}`;
    case 'latency':
      return `Latency spike on ${service}`;
    case 'silence':
      return `${service} stopped reporting`;
  }
}

/** Evaluate all three detectors; returns the breaching ones (0–3). */
export function evaluateDetections(
  rollup: Rollup,
  silence: SilenceInput,
  now: number,
  config: Config,
): Detection[] {
  const d = config.detection;
  const detections: Detection[] = [];
  const hasVolume = rollup.request_count >= d.minRequestsForDetection;

  // error_rate: error_rate ≥ threshold AND request_count ≥ min (SPEC §10.3).
  if (hasVolume && rollup.error_rate >= d.errorRateThreshold) {
    detections.push({
      detector: 'error_rate',
      observed_value: rollup.error_rate,
      threshold_value: d.errorRateThreshold,
      severity: errorRateSeverity(rollup.error_rate, d.errorRateThreshold),
      dominant_sig: rollup.dominant_sig,
      first_error_at: rollup.first_error_at,
    });
  }

  // latency: p95_ms ≥ threshold AND request_count ≥ min (SPEC §10.3).
  if (hasVolume && rollup.p95_ms >= d.latencyP95ThresholdMs) {
    detections.push({
      detector: 'latency',
      observed_value: rollup.p95_ms,
      threshold_value: d.latencyP95ThresholdMs,
      severity: latencySeverity(rollup.p95_ms, d.latencyP95ThresholdMs),
      dominant_sig: '',
      first_error_at: null,
    });
  }

  // silence: previously active AND now - last_event_at ≥ window (SPEC §10.3, FR-19).
  if (
    silence.wasActive &&
    silence.lastEventAt !== null &&
    now - silence.lastEventAt >= d.silenceWindowMs
  ) {
    detections.push({
      detector: 'silence',
      observed_value: now - silence.lastEventAt,
      threshold_value: d.silenceWindowMs,
      severity: 'high',
      dominant_sig: '',
      first_error_at: null,
    });
  }

  return detections;
}
