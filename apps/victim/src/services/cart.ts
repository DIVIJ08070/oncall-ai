/**
 * cart-api — per-user shopping carts for the demo commerce platform.
 *
 *   GET    /api/cart/:userId              -> { userId, items, subtotal }
 *   POST   /api/cart/:userId/items        { sku, qty } -> updated cart
 *   DELETE /api/cart/:userId/items/:sku   -> updated cart
 *
 * Carts are held in a bounded in-memory map (~30–60ms latency). Adding an unknown
 * SKU returns a realistic 404.
 */

import { Router } from 'express';
import { asyncRoute, delay, findProduct, jitter, type Product } from '../lib/sim.js';

export const cartRouter = Router();

interface CartLine {
  sku: string;
  name: string;
  qty: number;
  price: number;
}

const CARTS = new Map<string, CartLine[]>();
const MAX_CARTS = 1000;

function getCart(userId: string): CartLine[] {
  let cart = CARTS.get(userId);
  if (!cart) {
    cart = [];
    if (CARTS.size >= MAX_CARTS) {
      const oldest = CARTS.keys().next().value;
      if (oldest !== undefined) CARTS.delete(oldest);
    }
    CARTS.set(userId, cart);
  }
  return cart;
}

function subtotalOf(cart: CartLine[]): number {
  return Math.round(cart.reduce((sum, l) => sum + l.qty * l.price, 0) * 100) / 100;
}

function lineFrom(product: Product, qty: number): CartLine {
  return { sku: product.sku, name: product.name, qty, price: product.price };
}

cartRouter.get(
  '/:userId',
  asyncRoute(async (req, res) => {
    await delay(jitter(34));
    const cart = getCart(req.params.userId);
    return res.status(200).json({
      userId: req.params.userId,
      items: cart,
      subtotal: subtotalOf(cart),
    });
  }),
);

cartRouter.post(
  '/:userId/items',
  asyncRoute(async (req, res) => {
    await delay(jitter(48));
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
        error: { code: 'not_found', message: `no product with sku ${sku}` },
      });
    }
    const cart = getCart(req.params.userId);
    const existing = cart.find((l) => l.sku === product.sku);
    if (existing) existing.qty += quantity;
    else cart.push(lineFrom(product, quantity));

    return res.status(201).json({
      userId: req.params.userId,
      items: cart,
      subtotal: subtotalOf(cart),
    });
  }),
);

cartRouter.delete(
  '/:userId/items/:sku',
  asyncRoute(async (req, res) => {
    await delay(jitter(30));
    const cart = getCart(req.params.userId);
    const idx = cart.findIndex((l) => l.sku.toLowerCase() === req.params.sku.toLowerCase());
    if (idx === -1) {
      return res.status(404).json({
        error: { code: 'not_found', message: `sku ${req.params.sku} not in cart` },
      });
    }
    cart.splice(idx, 1);
    return res.status(200).json({
      userId: req.params.userId,
      items: cart,
      subtotal: subtotalOf(cart),
    });
  }),
);
