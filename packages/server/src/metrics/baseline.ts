import type { MetricsBaseline } from '@oncall/shared';
import type { OncallDb } from '../db/index.js';
import { rollupWindow } from './rollup.js';
import { baselineRange } from './windows.js';

/**
 * Baseline computation (SPEC §10.2 / §7.2 `baseline`). The baseline is the
 * trailing 5 min **excluding** the most recent 60 s, so a current spike does not
 * pollute the "normal" reference the agent and dashboard compare against.
 */
export async function computeBaseline(
  db: OncallDb,
  customerId: string,
  service: string,
  now: number,
): Promise<MetricsBaseline> {
  const { from, to } = baselineRange(now);
  // Guard the degenerate early window (`to < from`) that occurs in the first
  // minute of a service's life → empty baseline.
  if (to <= from) return { error_rate: 0, p95_ms: 0 };
  const rollup = await rollupWindow(db, customerId, service, from, to);
  return { error_rate: rollup.error_rate, p95_ms: rollup.p95_ms };
}
