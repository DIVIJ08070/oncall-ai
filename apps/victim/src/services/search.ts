/**
 * search-ai — semantic product search & autocomplete (SPEC §12 AI plane).
 *
 *   POST /api/search/semantic       { query, limit? } -> ranked results + relevance
 *   GET  /api/search/autocomplete    (?q=)            -> ranked suggestions
 *
 * Embedding-model shaped: `model`, per-result `relevance`, `took_ms` (the embed +
 * ANN lookup time, ~180–500ms), and an overall `confidence`. Matching is a light
 * lexical overlap over the in-memory catalog dressed up as a vector search.
 */

import { Router } from 'express';
import { asyncRoute, CATALOG, CATEGORIES, delay, jitter, round, score, type Product } from '../lib/sim.js';

export const searchRouter = Router();

const MODEL = 'embed-bge-large';

/** Cheap lexical overlap in [0,1] between a query and a product, as pseudo-cosine. */
function relevanceOf(query: string, p: Product): number {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (q.length === 0) return 0;
  const hay = `${p.name} ${p.category}`.toLowerCase();
  let hits = 0;
  for (const term of q) if (hay.includes(term)) hits++;
  const base = hits / q.length;
  // Blend the lexical signal with a little model "noise" so scores look continuous.
  return round(Math.min(0.99, base * 0.7 + Math.random() * 0.3), 3);
}

searchRouter.post(
  '/semantic',
  asyncRoute(async (req, res) => {
    const took_ms = jitter(340, 0.45); // ~190–490ms
    await delay(took_ms);
    const { query, limit } = (req.body ?? {}) as { query?: string; limit?: number };
    if (typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({
        error: { code: 'validation_error', message: 'query is required' },
      });
    }
    const n = Number.isFinite(limit) && (limit as number) > 0 ? Math.floor(limit as number) : 5;
    const results = CATALOG.map((p) => ({ sku: p.sku, name: p.name, relevance: relevanceOf(query, p) }))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, n);
    return res.status(200).json({
      model: MODEL,
      query,
      results,
      confidence: score(0.65, 0.96),
      took_ms,
    });
  }),
);

searchRouter.get(
  '/autocomplete',
  asyncRoute(async (req, res) => {
    const took_ms = jitter(220, 0.4); // ~130–310ms
    await delay(took_ms);
    const q = (typeof req.query.q === 'string' ? req.query.q : '').toLowerCase().trim();
    const pool = [...CATALOG.map((p) => p.name), ...CATEGORIES];
    const suggestions = (q === ''
      ? pool.slice(0, 6)
      : pool.filter((s) => s.toLowerCase().includes(q)).slice(0, 6)
    ).map((text) => ({ text, score: score(0.5, 0.95) }))
      .sort((a, b) => b.score - a.score);
    return res.status(200).json({
      model: MODEL,
      q,
      suggestions,
      took_ms,
    });
  }),
);
