/**
 * orders-api — order creation & lookup for the demo commerce platform.
 *
 *   POST /api/orders             { userId, items: [{ sku, qty }] } -> order
 *   GET  /api/orders/:orderId    -> order or 404
 *   GET  /api/orders?userId=     -> { orders, count }
 *
 * Order writes are ~50–110ms (they fan out to inventory/payments in a real system).
 * Orders are held in a bounded in-memory map. Line prices come from the catalog.
 */

import { Router } from 'express';
import { asyncRoute, delay, findProduct, jitter, orderId } from '../lib/sim.js';

export const ordersRouter = Router();

interface OrderLine {
  sku: string;
  name: string;
  qty: number;
  price: number;
}
interface Order {
  orderId: string;
  userId: string;
  items: OrderLine[];
  total: number;
  status: string;
  createdAt: number;
}

const ORDERS = new Map<string, Order>();
const MAX_ORDERS = 2000;

function remember(order: Order): void {
  if (ORDERS.size >= MAX_ORDERS) {
    const oldest = ORDERS.keys().next().value;
    if (oldest !== undefined) ORDERS.delete(oldest);
  }
  ORDERS.set(order.orderId, order);
}

ordersRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    await delay(jitter(80));
    const { userId, items } = (req.body ?? {}) as {
      userId?: string;
      items?: Array<{ sku?: string; qty?: number }>;
    };
    if (!userId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: { code: 'validation_error', message: 'userId and a non-empty items array are required' },
      });
    }

    const lines: OrderLine[] = [];
    for (const raw of items) {
      const product = raw.sku ? findProduct(raw.sku) : undefined;
      if (!product) {
        return res.status(422).json({
          error: { code: 'invalid_line_item', message: `unknown sku ${raw.sku ?? '(missing)'}` },
        });
      }
      const qty = Number.isFinite(raw.qty) && (raw.qty as number) > 0 ? Math.floor(raw.qty as number) : 1;
      lines.push({ sku: product.sku, name: product.name, qty, price: product.price });
    }

    const total = Math.round(lines.reduce((s, l) => s + l.qty * l.price, 0) * 100) / 100;
    const order: Order = {
      orderId: orderId(),
      userId,
      items: lines,
      total,
      status: 'confirmed',
      createdAt: Date.now(),
    };
    remember(order);
    return res.status(201).json(order);
  }),
);

ordersRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    await delay(jitter(44));
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    let orders = Array.from(ORDERS.values());
    if (userId) orders = orders.filter((o) => o.userId === userId);
    orders = orders.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    return res.status(200).json({ orders, count: orders.length });
  }),
);

ordersRouter.get(
  '/:orderId',
  asyncRoute(async (req, res) => {
    await delay(jitter(36));
    const order = ORDERS.get(req.params.orderId);
    if (!order) {
      return res.status(404).json({
        error: { code: 'not_found', message: `no order with id ${req.params.orderId}` },
      });
    }
    return res.status(200).json(order);
  }),
);
