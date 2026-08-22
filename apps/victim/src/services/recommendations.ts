/**
 * recommendations-ai — model-served product recommendations (SPEC §12 AI plane).
 *
 *   GET /api/recommendations        (?userId=&?limit=) -> personalized items + scores
 *   GET /api/recommendations/trending                  -> trending items + scores
 *   GET /api/similar/:sku           (?limit=)          -> ranked similar products
 *
 * These feel like real model inference: higher latency (~200–400ms) and responses
 * shaped like model output (`model`, `confidence`, per-item `score`, `latencyMs`).
 * Two routers share the `recommendations-ai` service name so they can mount at
 * non-overlapping prefixes (/api/recommendations, /api/similar) without a shared
 * "/api" telemetry mount double-counting sibling APIs.
 */

import { Router } from 'express';
import {
  asyncRoute,
  CATALOG,
  delay,
  findProduct,
  jitter,
  pick,
  round,
  score,
  USERS,
  type Product,
} from '../lib/sim.js';

const MODEL = 'rec-transformer-v3';

/** Rank a set of products with descending pseudo model scores. */
function ranked(products: readonly Product[], limit: number): Array<{ sku: string; name: string; score: number }> {
  return products
    .map((p) => ({ sku: p.sku, name: p.name, score: score(0.4, 0.98) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function limitOf(raw: unknown, def: number): number {
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), CATALOG.length) : def;
}

/** Mounted at /api/recommendations. */
export const recommendationsRouter = Router();

recommendationsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const latencyMs = jitter(300, 0.33); // ~200–400ms model inference
    await delay(latencyMs);
    const userId = typeof req.query.userId === 'string' ? req.query.userId : pick(USERS).id;
    const limit = limitOf(req.query.limit, 6);
    // Seed the "personalization" off a random slice so items vary per call.
    const shuffled = CATALOG.slice().sort(() => Math.random() - 0.5);
    return res.status(200).json({
      model: MODEL,
      userId,
      items: ranked(shuffled, limit),
      confidence: score(0.7, 0.97),
      latencyMs,
    });
  }),
);

recommendationsRouter.get(
  '/trending',
  asyncRoute(async (_req, res) => {
    const latencyMs = jitter(260, 0.33);
    await delay(latencyMs);
    const shuffled = CATALOG.slice().sort(() => Math.random() - 0.5);
    return res.status(200).json({
      model: MODEL,
      window: 'last_24h',
      items: ranked(shuffled, 8),
      confidence: score(0.75, 0.98),
      latencyMs,
    });
  }),
);

/** Mounted at /api/similar. */
export const similarRouter = Router();

similarRouter.get(
  '/:sku',
  asyncRoute(async (req, res) => {
    const latencyMs = jitter(320, 0.33);
    await delay(latencyMs);
    const anchor = findProduct(req.params.sku);
    if (!anchor) {
      return res.status(404).json({
        error: { code: 'not_found', message: `no product with sku ${req.params.sku}` },
      });
    }
    const limit = limitOf(req.query.limit, 5);
    // Prefer same-category products, then fall back to the rest of the catalog.
    const sameCat = CATALOG.filter((p) => p.category === anchor.category && p.sku !== anchor.sku);
    const others = CATALOG.filter((p) => p.category !== anchor.category);
    const pool = [...sameCat, ...others];
    return res.status(200).json({
      model: MODEL,
      sku: anchor.sku,
      similar: ranked(pool, limit),
      confidence: round(score(0.6, 0.95) - 0.02, 3),
      latencyMs,
    });
  }),
);
