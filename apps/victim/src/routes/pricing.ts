/**
 * GET /api/pricing — the `config_error` failure mode (SPEC §12).
 *
 * Healthy: `PRICING_TABLE` has a default, so pricing resolves. The seeded
 * `config_error` commit removes that default; when the env var is unset the
 * deployed app throws "Missing config PRICING_TABLE". Here we keep the default
 * present and simulate the failure on a subset of requests while the mode is
 * active (SPEC §12 "throws on subset"). The fix is a revert restoring the default.
 */

import { Router } from 'express';
import { config } from '../config.js';
import { getActiveMode } from '../control.js';

export const pricingRouter = Router();

pricingRouter.get('/', (_req, res) => {
  const pricingTable =
    getActiveMode() === 'config_error' &&
    Math.random() < config.configErrorFailRatio
      ? undefined // simulate the removed config default on this subset of requests
      : config.pricingTable;

  if (!pricingTable) {
    throw new Error('Missing config PRICING_TABLE');
  }

  return res.status(200).json({
    ok: true,
    table: pricingTable,
    plans: [
      { id: 'basic', price_cents: 900 },
      { id: 'pro', price_cents: 2900 },
      { id: 'scale', price_cents: 9900 },
    ],
  });
});
