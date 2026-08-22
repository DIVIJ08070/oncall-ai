/**
 * Service registry for the demo AI commerce platform.
 *
 * Each entry is a `ServiceDef { name, basePath, router }`. `mountService` gives
 * every entry its OWN telemetry instance tagged with the service `name`, so the
 * platform (which groups by (service, endpoint)) sees a rich, multi-service
 * dashboard. `server.ts` mounts every entry in `SERVICES`.
 *
 * IMPORTANT: the original failure-mode demo (checkout / reports / pricing) is
 * preserved verbatim — same routers, same `getActiveMode()` behavior — and kept
 * under the service name "checkout-api" (referenced by the demo/docs). Do NOT
 * rename it.
 *
 * Registry conventions for appended services (e.g. AI services):
 *   - `basePath` MUST be a unique prefix that is NOT a prefix of another entry's
 *     basePath (a telemetry mount at a shared prefix like "/api" would run for —
 *     and double-count — sibling services). Use a dedicated segment, e.g.
 *     "/api/ai", "/api/search".
 *   - Multiple entries MAY share a `name` (as the 3 checkout-api routes and the 2
 *     catalog-api routers do) when one logical service spans disjoint prefixes.
 */

import type { Express, Router } from 'express';
import { config } from '../config.js';
import { oncall, type OncallMiddleware } from '../telemetry.js';

// Existing failure-mode demo routers (unchanged) — kept under "checkout-api".
import { checkoutRouter } from '../routes/checkout.js';
import { reportsRouter } from '../routes/reports.js';
import { pricingRouter } from '../routes/pricing.js';

// New commerce services.
import { authRouter } from './auth.js';
import { productsRouter, categoriesRouter } from './catalog.js';
import { cartRouter } from './cart.js';
import { inventoryRouter } from './inventory.js';
import { paymentsRouter } from './payments.js';
import { ordersRouter } from './orders.js';

// AI services (model-inference flavored: higher latency, model-shaped responses).
import { recommendationsRouter, similarRouter } from './recommendations.js';
import { fraudRouter } from './fraud.js';
import { searchRouter } from './search.js';
import { supportRouter } from './support.js';
import { forecastRouter } from './forecasting.js';

/** One mountable service: a telemetry service `name`, a URL `basePath`, a `router`. */
export interface ServiceDef {
  /** Telemetry service name stamped on every event from this router. */
  name: string;
  /** Unique URL prefix to mount at (must not be a prefix of another entry's). */
  basePath: string;
  /** The Express router implementing the endpoints. */
  router: Router;
}

/** Every service the platform exposes. `server.ts` mounts each via `mountService`. */
export const SERVICES: ServiceDef[] = [
  // ── failure-mode demo (unchanged behavior; all tagged "checkout-api") ──────
  { name: 'checkout-api', basePath: '/api/checkout', router: checkoutRouter }, // bad_deploy
  { name: 'checkout-api', basePath: '/api/reports', router: reportsRouter }, //   slow_db
  { name: 'checkout-api', basePath: '/api/pricing', router: pricingRouter }, //   config_error

  // ── commerce services (each its own telemetry service name) ────────────────
  { name: 'auth-api', basePath: '/api/auth', router: authRouter },
  { name: 'catalog-api', basePath: '/api/products', router: productsRouter },
  { name: 'catalog-api', basePath: '/api/categories', router: categoriesRouter },
  { name: 'cart-api', basePath: '/api/cart', router: cartRouter },
  { name: 'inventory-api', basePath: '/api/inventory', router: inventoryRouter },
  { name: 'payments-api', basePath: '/api/payments', router: paymentsRouter },
  { name: 'orders-api', basePath: '/api/orders', router: ordersRouter },

  // ── AI services (each its own telemetry service name) ──────────────────────
  { name: 'recommendations-ai', basePath: '/api/recommendations', router: recommendationsRouter },
  { name: 'recommendations-ai', basePath: '/api/similar', router: similarRouter },
  { name: 'fraud-detection-ai', basePath: '/api/fraud', router: fraudRouter },
  { name: 'search-ai', basePath: '/api/search', router: searchRouter },
  { name: 'support-ai', basePath: '/api/support', router: supportRouter },
  { name: 'forecasting-ai', basePath: '/api/forecast', router: forecastRouter },
];

/**
 * Mount one service with its own telemetry:
 *   `app.use(basePath, tel, router, tel.errorHandler)`
 * The request logger `tel` emits one info event per request (tagged `def.name`);
 * `tel.errorHandler` ships thrown errors with a stack before the global responder.
 * Returns the middleware so callers can `await tel.client.close()` on shutdown.
 */
export function mountService(app: Express, def: ServiceDef): OncallMiddleware {
  const tel = oncall({
    apiKey: config.apiKey,
    service: def.name,
    ingestUrl: config.ingestUrl,
  });
  app.use(def.basePath, tel, def.router, tel.errorHandler);
  return tel;
}
