import { createHash } from 'node:crypto';
import type { Detector } from '@oncall/shared';

/**
 * Incident dedup fingerprint (SPEC §10.2):
 *
 *   `sha1(service + "|" + detector + "|" + dominant_sig)`
 *
 * where `dominant_sig` is the most frequent normalized `fingerprint_sig` among
 * the window's error events (computed by `metrics/rollup.ts#dominantSignature`).
 * For the `latency` and `silence` detectors `dominant_sig` is `""` (there is no
 * dominant error message), so those collapse to one incident per service.
 *
 * This value is stored in `incidents.fingerprint` and is the key the
 * `IncidentsDao.openOrDedup` code-enforced dedup rule (§8) matches on.
 */
export function detectionFingerprint(
  service: string,
  detector: Detector,
  dominantSig: string,
): string {
  return createHash('sha1')
    .update(`${service}|${detector}|${dominantSig}`)
    .digest('hex');
}
