/**
 * Rollup window constants (SPEC §10.2).
 *
 * - **Current window:** trailing 60 s for error rate + latency percentiles.
 * - **Baseline window:** trailing 5 min *excluding* the last 60 s — i.e.
 *   `[now - 300 s, now - 60 s]` — used for the `/metrics` baseline (§7.2) and
 *   the `get_metrics` tool (§9).
 */

/** Trailing rollup window in seconds (SPEC §10.2 — "trailing 60s"). */
export const WINDOW_SEC = 60;
export const WINDOW_MS = WINDOW_SEC * 1000;

/** Total baseline span (5 min) before the recent window is excluded. */
export const BASELINE_TOTAL_MS = 5 * 60 * 1000;

/** Baseline window = `[now - BASELINE_TOTAL_MS, now - WINDOW_MS]`. */
export function baselineRange(now: number): { from: number; to: number } {
  return { from: now - BASELINE_TOTAL_MS, to: now - WINDOW_MS };
}

/** Current window = `[now - WINDOW_MS, now]`. */
export function currentRange(now: number): { from: number; to: number } {
  return { from: now - WINDOW_MS, to: now };
}
