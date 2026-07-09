/**
 * Detection engine module (SPEC §10, FR-05/06/12/19). The 15 s `setInterval`
 * loop, threshold evaluation, fingerprint dedup, the incident lifecycle state
 * machine, silence detection, and the recovery-verification seam.
 *
 * **Boot wiring (one line, for the integrating chunk / C10):**
 * ```ts
 * import { createDetectionEngine } from './detection/index.js';
 * const detection = createDetectionEngine({ config, db, broker });
 * detection.start(); // begins the DETECTION_INTERVAL_MS loop
 * // C7 injects `enqueuer` (real agent); C9 injects/drives `recoveryVerifier`.
 * ```
 */
export * from './clock.js';
export * from './fingerprint.js';
export * from './thresholds.js';
export * from './lifecycle.js';
export * from './recovery.js';
export * from './seams.js';
export * from './engine.js';
