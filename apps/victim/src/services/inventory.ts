/**
 * inventory-api — stock levels & reservations for the demo commerce platform.
 *
 *   GET  /api/inventory/:sku       -> { sku, available, reserved, warehouse }
 *   POST /api/inventory/reserve    { sku, qty } -> reservation or 409 out-of-stock
 *
 * Lookups are ~25–60ms. Reservations fail out-of-stock ~2% of the time (409) for a
 * realistic baseline error rate. Stock numbers are deterministic per SKU so the
 * dashboard looks stable across requests.
 */

import { Router } from 'express';
import { asyncRoute, delay, findProduct, jitter, maybeFail, pick, reservationId } from '../lib/sim.js';

export const inventoryRouter = Router();

const WAREHOUSES = ['us-east-1', 'us-west-2', 'eu-central-1'] as const;

/** Deterministic pseudo-stock for a SKU so repeated reads are consistent. */
function stockFor(sku: string): { available: number; reserved: number; warehouse: string } {
  let hash = 0;
  for (let i = 0; i < sku.length; i++) hash = (hash * 31 + sku.charCodeAt(i)) >>> 0;
  const available = 5 + (hash % 240);
  const reserved = hash % 12;
  const warehouse = WAREHOUSES[hash % WAREHOUSES.length];
  return { available, reserved, warehouse };
}

inventoryRouter.get(
  '/:sku',
  asyncRoute(async (req, res) => {
    await delay(jitter(40));
    const product = findProduct(req.params.sku);
    if (!product) {
      return res.status(404).json({
        error: { code: 'not_found', message: `no inventory record for sku ${req.params.sku}` },
      });
    }
    const stock = stockFor(product.sku);
    return res.status(200).json({ sku: product.sku, ...stock });
  }),
);

inventoryRouter.post(
  '/reserve',
  asyncRoute(async (req, res) => {
    await delay(jitter(52));
    const { sku, qty } = (req.body ?? {}) as { sku?: string; qty?: number };
    const quantity = Number.isFinite(qty) && (qty as number) > 0 ? Math.floor(qty as number) : 1;
    if (!sku) {
      return res.status(400).json({
        error: { code: 'validation_error', message: 'sku is required' },
      });
    }
    const product = findProduct(sku);
    if (!product) {
      return res.status(404).json({
        error: { code: 'not_found', message: `no inventory record for sku ${sku}` },
      });
    }
    // ~2% out-of-stock — a realistic baseline error rate.
    if (maybeFail(0.02)) {
      return res.status(409).json({
        error: { code: 'out_of_stock', message: `sku ${product.sku} is out of stock` },
      });
    }
    return res.status(201).json({
      reservationId: reservationId(),
      sku: product.sku,
      qty: quantity,
      warehouse: pick(WAREHOUSES),
      expiresIn: 900,
    });
  }),
);
