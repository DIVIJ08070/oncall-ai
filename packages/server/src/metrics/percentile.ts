/**
 * Percentile helper for latency rollups (SPEC §10.2, §7.2 `current`/`series`).
 *
 * Uses linear interpolation between closest ranks (the "type 7" method, the
 * default in NumPy/most stats libs). Returns an **integer** millisecond value to
 * match the `p50_ms`/`p95_ms`/`p99_ms` INTEGER columns of `metric_samples` (§8).
 */

/**
 * Compute the `p`-th percentile (0–100) of `values` (unsorted OK), rounded to an
 * integer. Empty input → `0`.
 */
export function percentile(values: readonly number[], p: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return Math.round(values[0]);
  const sorted = [...values].sort((a, b) => a - b);
  const clampedP = Math.min(Math.max(p, 0), 100);
  const rank = (clampedP / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return Math.round(sorted[lo]);
  const frac = rank - lo;
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * frac);
}
