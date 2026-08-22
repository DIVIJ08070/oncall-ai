/**
 * catalog-api — product catalog & categories for the demo commerce platform.
 *
 *   GET /api/products            (?category=&?limit=) -> { products, count }
 *   GET /api/products/:sku       -> product or 404
 *   GET /api/categories          -> { categories }
 *
 * Catalog reads are ~30–80ms. Two routers share the `catalog-api` service name so
 * that /api/products and /api/categories can mount at non-overlapping prefixes
 * (a telemetry mount at a shared "/api" prefix would double-count sibling APIs).
 */

import { Router } from 'express';
import { asyncRoute, CATALOG, CATEGORIES, delay, findProduct, jitter } from '../lib/sim.js';

/** Mounted at /api/products. */
export const productsRouter = Router();

productsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    await delay(jitter(55));
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined;

    let products = CATALOG.slice();
    if (category) {
      products = products.filter((p) => p.category.toLowerCase() === category.toLowerCase());
    }
    if (limit !== undefined) products = products.slice(0, limit);

    return res.status(200).json({ products, count: products.length });
  }),
);

productsRouter.get(
  '/:sku',
  asyncRoute(async (req, res) => {
    await delay(jitter(38));
    const product = findProduct(req.params.sku);
    if (!product) {
      return res.status(404).json({
        error: { code: 'not_found', message: `no product with sku ${req.params.sku}` },
      });
    }
    return res.status(200).json({ product });
  }),
);

/** Mounted at /api/categories. */
export const categoriesRouter = Router();

categoriesRouter.get(
  '/',
  asyncRoute(async (_req, res) => {
    await delay(jitter(32));
    return res.status(200).json({ categories: CATEGORIES });
  }),
);
