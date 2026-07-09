/**
 * GET /api/reports — the `slow_db` failure mode (SPEC §12).
 *
 * Healthy: an indexed query returns in a few ms. The seeded `slow_db` commit swaps
 * it for a slow full-scan path (a 2–4s sleep), pushing p95 past the 1000ms latency
 * threshold → a `latency` incident. The fix is a revert (or a cache/limit patch).
 */

import { Router } from 'express';
import { config } from '../config.js';
import { getActiveMode } from '../control.js';

export const reportsRouter = Router();

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** The healthy, indexed report query (fast). */
function fastReportQuery(): { rows: number; window: string } {
  return { rows: 128, window: 'last_24h' };
}

reportsRouter.get('/', async (_req, res) => {
  if (getActiveMode() === 'slow_db') {
    // BUG (query swapped for a slow full-scan path by the bad deploy).
    const jitter =
      config.slowDbMinMs +
      Math.floor(Math.random() * Math.max(1, config.slowDbMaxMs - config.slowDbMinMs));
    await sleep(jitter);
  }

  const result = fastReportQuery();
  return res.status(200).json({
    ok: true,
    report: result,
    generated_at: Date.now(),
  });
});
