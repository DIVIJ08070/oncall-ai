/**
 * POST /api/checkout — the `bad_deploy` (null-ref) failure mode (SPEC §12).
 *
 * Healthy: a null guard (`sessionCart?.items`) tolerates a request with no active
 * session cart and falls back to the request body. The seeded `bad_deploy` commit
 * removes that guard, so `sessionCart.items` dereferences `undefined` →
 * `TypeError: Cannot read properties of undefined (reading 'items')` → 500.
 * The fix is a revert that restores the `?.` guard.
 */

import { Router } from 'express';
import { getActiveMode } from '../control.js';

export const checkoutRouter = Router();

interface Cart {
  items?: Array<{ sku: string; qty: number; price: number }>;
}

/**
 * Look up the cart attached to the caller's session. For the demo traffic there
 * is no persisted session, so this returns `undefined` — which the healthy guard
 * tolerates and the bad deploy does not.
 */
function getSessionCart(): Cart | undefined {
  return undefined;
}

checkoutRouter.post('/', (req, res) => {
  const sessionCart = getSessionCart();
  const bodyCart = ((req.body ?? {}) as { cart?: Cart }).cart;

  let items: NonNullable<Cart['items']>;
  if (getActiveMode() === 'bad_deploy') {
    // BUG (null guard removed by the bad deploy): `sessionCart` is undefined →
    // TypeError: Cannot read properties of undefined (reading 'items').
    items = (sessionCart as Cart).items ?? bodyCart?.items ?? [];
  } else {
    // Healthy: guard tolerates a missing session cart.
    items = sessionCart?.items ?? bodyCart?.items ?? [];
  }

  const total = items.reduce((sum, it) => sum + it.qty * it.price, 0);
  return res.status(200).json({
    ok: true,
    order_id: `ord_${Date.now().toString(36)}`,
    item_count: items.length,
    total_cents: Math.round(total * 100),
  });
});
