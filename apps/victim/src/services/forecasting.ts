/**
 * forecasting-ai — time-series demand & revenue forecasting (SPEC §12 AI plane).
 *
 *   GET /api/forecast/demand     (?sku=&?horizonDays=) -> per-day demand forecast
 *   GET /api/forecast/revenue    (?days=)              -> revenue forecast
 *
 * Time-series-model shaped: `model` ("ts-prophet"), a `predicted` series, a `mape`
 * accuracy figure, `confidence`, and `latencyMs` (~150–350ms). Predictions are a
 * seeded random walk so a repeated call looks stable-ish but alive.
 */

import { Router } from 'express';
import { asyncRoute, CATALOG, delay, findProduct, jitter, pick, round, score } from '../lib/sim.js';

export const forecastRouter = Router();

const MODEL = 'ts-prophet';

function horizonOf(raw: unknown, def: number): number {
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 90) : def;
}

forecastRouter.get(
  '/demand',
  asyncRoute(async (req, res) => {
    const latencyMs = jitter(240, 0.4); // ~145–335ms
    await delay(latencyMs);
    const sku = typeof req.query.sku === 'string' ? req.query.sku : pick(CATALOG).sku;
    const product = findProduct(sku);
    if (!product) {
      return res.status(404).json({
        error: { code: 'not_found', message: `no product with sku ${sku}` },
      });
    }
    const horizonDays = horizonOf(req.query.horizonDays, 14);
    let level = 40 + Math.random() * 60;
    const predicted = Array.from({ length: horizonDays }, (_, i) => {
      level = Math.max(0, level + (Math.random() * 2 - 1) * 8);
      return { day: i + 1, units: Math.round(level) };
    });
    return res.status(200).json({
      model: MODEL,
      sku: product.sku,
      horizonDays,
      predicted,
      mape: round(0.05 + Math.random() * 0.13, 3),
      confidence: score(0.7, 0.95),
      latencyMs,
    });
  }),
);

forecastRouter.get(
  '/revenue',
  asyncRoute(async (req, res) => {
    const latencyMs = jitter(280, 0.4); // ~170–390ms
    await delay(latencyMs);
    const days = horizonOf(req.query.days, 7);
    let level = 8000 + Math.random() * 6000;
    const predicted = Array.from({ length: days }, (_, i) => {
      level = Math.max(0, level + (Math.random() * 2 - 1) * 900);
      return { day: i + 1, revenue: round(level, 2) };
    });
    return res.status(200).json({
      model: MODEL,
      currency: 'usd',
      days,
      predicted,
      mape: round(0.06 + Math.random() * 0.12, 3),
      confidence: score(0.68, 0.93),
      latencyMs,
    });
  }),
);
