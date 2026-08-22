/**
 * Built-in self-traffic generator — the demo centerpiece.
 *
 * When `VICTIM_SELF_TRAFFIC=1`, `server.ts` calls `startSelfTraffic(port)` right
 * after `listen`. It then fires a realistic, weighted MIX of requests against the
 * app's OWN endpoints (plain `fetch` to `http://localhost:PORT`) across ALL
 * services — busy services (catalog, auth, recommendations, search) get much more
 * traffic than rare ones (refunds, forecast) — at roughly 6–12 req/s with jitter.
 *
 * This keeps the platform dashboard ALIVE with believable multi-service traffic
 * during a demo with zero manual work, and — because it also exercises the
 * failure-mode demo routes (checkout / reports / pricing) — flipping the failure
 * mode via `/__control/*` immediately produces the error/latency signal on the
 * dashboard without a single manual curl.
 *
 * Properties: OFF by default; fire-and-forget so the request rate is governed by
 * the timer (not endpoint latency); fully fail-silent (a dead port or a 5xx never
 * throws); all timers `unref()`-ed so they never keep the process alive.
 */

import { CATALOG, jitter, pick, USERS } from './lib/sim.js';

/** One weighted request template fired against the app's own HTTP surface. */
interface TrafficSpec {
  /** Relative weight — higher means the request is fired more often. */
  weight: number;
  method: 'GET' | 'POST' | 'DELETE';
  /** Build the request path (may embed a random path param). */
  path: () => string;
  /** Build a JSON body (POST only). */
  body?: () => unknown;
  /** Build extra headers (e.g. an Authorization bearer). */
  headers?: () => Record<string, string>;
}

const rndSku = (): string => pick(CATALOG).sku;
const rndUser = (): string => pick(USERS).id;
const rndAmount = (): number => Math.round((10 + Math.random() * 290) * 100) / 100;
const rndTxn = (): string => `txn_${Math.random().toString(36).slice(2, 12)}`;

const SEARCH_QUERIES = [
  'wireless headphones',
  'mechanical keyboard',
  'coffee',
  'warm blanket',
  'running shoes',
  'gift under 30',
  'usb-c charger',
  'honey',
] as const;

const CHAT_MESSAGES = [
  'Where is my order?',
  'I want to return an item',
  'Do you have this in stock?',
  'My payment was declined',
  'How do I change my address?',
  'Can I get a refund?',
] as const;

/**
 * The weighted request mix. Busy customer-facing + AI services dominate; write and
 * "rare" operations (refunds, revenue forecast) are a small slice. The failure-mode
 * demo routes are included at a modest, steady rate so flipping the mode lights up
 * the dashboard automatically.
 */
const SPECS: readonly TrafficSpec[] = [
  // ── catalog-api (very busy reads) ──────────────────────────────────────────
  { weight: 12, method: 'GET', path: () => '/api/products' },
  { weight: 8, method: 'GET', path: () => `/api/products/${rndSku()}` },
  { weight: 4, method: 'GET', path: () => '/api/categories' },

  // ── auth-api (busy) ────────────────────────────────────────────────────────
  {
    weight: 10,
    method: 'POST',
    path: () => '/api/auth/login',
    body: () => ({ email: `${pick(USERS).email}`, password: 'hunter2' }),
  },
  {
    weight: 6,
    method: 'GET',
    path: () => '/api/auth/me',
    headers: () => ({ authorization: 'Bearer tok_demo_selftraffic' }),
  },

  // ── recommendations-ai (busy) ──────────────────────────────────────────────
  { weight: 10, method: 'GET', path: () => `/api/recommendations?userId=${rndUser()}` },
  { weight: 6, method: 'GET', path: () => `/api/similar/${rndSku()}` },
  { weight: 3, method: 'GET', path: () => '/api/recommendations/trending' },

  // ── search-ai (busy) ───────────────────────────────────────────────────────
  {
    weight: 8,
    method: 'POST',
    path: () => '/api/search/semantic',
    body: () => ({ query: pick(SEARCH_QUERIES) }),
  },
  { weight: 8, method: 'GET', path: () => `/api/search/autocomplete?q=${encodeURIComponent(pick(SEARCH_QUERIES).slice(0, 4))}` },

  // ── cart-api (medium) ──────────────────────────────────────────────────────
  { weight: 5, method: 'GET', path: () => `/api/cart/${rndUser()}` },
  {
    weight: 5,
    method: 'POST',
    path: () => `/api/cart/${rndUser()}/items`,
    body: () => ({ sku: rndSku(), qty: 1 + Math.floor(Math.random() * 3) }),
  },

  // ── inventory-api (medium) ─────────────────────────────────────────────────
  { weight: 6, method: 'GET', path: () => `/api/inventory/${rndSku()}` },
  {
    weight: 3,
    method: 'POST',
    path: () => '/api/inventory/reserve',
    body: () => ({ sku: rndSku(), qty: 1 + Math.floor(Math.random() * 2) }),
  },

  // ── orders-api (medium) ────────────────────────────────────────────────────
  {
    weight: 4,
    method: 'POST',
    path: () => '/api/orders',
    body: () => ({ userId: rndUser(), items: [{ sku: rndSku(), qty: 1 + Math.floor(Math.random() * 2) }] }),
  },
  { weight: 3, method: 'GET', path: () => `/api/orders?userId=${rndUser()}` },

  // ── payments-api (medium; refunds rare) ────────────────────────────────────
  {
    weight: 5,
    method: 'POST',
    path: () => '/api/payments/charge',
    body: () => ({ amount: rndAmount(), currency: 'usd', token: 'tok_demo_selftraffic' }),
  },
  {
    weight: 1,
    method: 'POST',
    path: () => `/api/payments/refund/${rndTxn()}`,
    body: () => ({ amount: rndAmount() }),
  },

  // ── fraud-detection-ai (medium) ────────────────────────────────────────────
  {
    weight: 6,
    method: 'POST',
    path: () => '/api/fraud/score',
    body: () => ({ txnId: rndTxn(), amount: rndAmount(), userId: rndUser() }),
  },

  // ── support-ai (medium/low; LLM latency) ───────────────────────────────────
  {
    weight: 4,
    method: 'POST',
    path: () => '/api/support/chat',
    body: () => ({ message: pick(CHAT_MESSAGES), sessionId: `sess_${rndUser()}` }),
  },
  {
    weight: 3,
    method: 'POST',
    path: () => '/api/support/classify',
    body: () => ({ message: pick(CHAT_MESSAGES) }),
  },
  { weight: 2, method: 'GET', path: () => `/api/support/faq?q=${encodeURIComponent(pick(CHAT_MESSAGES).slice(0, 6))}` },

  // ── forecasting-ai (rare) ──────────────────────────────────────────────────
  { weight: 2, method: 'GET', path: () => `/api/forecast/demand?sku=${rndSku()}` },
  { weight: 1, method: 'GET', path: () => '/api/forecast/revenue?days=7' },

  // ── failure-mode demo (checkout-api) — modest, steady, so flipping a mode ──
  //    lights up the dashboard with zero manual curl. Bodies are the HEALTHY
  //    happy-path shapes; the mode switch is what makes them fail.
  {
    weight: 5,
    method: 'POST',
    path: () => '/api/checkout',
    body: () => ({ cart: { items: [{ sku: rndSku(), qty: 1, price: rndAmount() }] } }),
  },
  { weight: 4, method: 'GET', path: () => '/api/reports' },
  { weight: 4, method: 'GET', path: () => '/api/pricing' },
];

const TOTAL_WEIGHT = SPECS.reduce((sum, s) => sum + s.weight, 0);

/** Weighted pick over `SPECS`. */
function pickSpec(): TrafficSpec {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const s of SPECS) {
    r -= s.weight;
    if (r < 0) return s;
  }
  return SPECS[SPECS.length - 1] as TrafficSpec;
}

let started = false;

/**
 * Start the self-traffic loop against `http://localhost:${port}`. Idempotent and
 * fail-silent. All timers are `unref()`-ed so the loop never keeps Node alive.
 */
export function startSelfTraffic(port: number): void {
  if (started) return;
  if (typeof globalThis.fetch !== 'function') return;
  started = true;
  const base = `http://localhost:${port}`;

  const fire = (): void => {
    const spec = pickSpec();
    const init: RequestInit = { method: spec.method };
    const headers: Record<string, string> = spec.headers ? spec.headers() : {};
    if (spec.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(spec.body());
    }
    if (Object.keys(headers).length > 0) init.headers = headers;
    // Fire-and-forget; swallow every error (dead port, 4xx/5xx, abort) — NFR-04.
    void fetch(base + spec.path(), init)
      .then((r) => r.arrayBuffer())
      .catch(() => {
        /* fail-silent */
      });
  };

  // Self-rescheduling timer: next tick is scheduled independent of request
  // latency, so the ~6–12 req/s rate holds even when slow LLM routes are hit.
  const tick = (): void => {
    fire();
    const t = setTimeout(tick, jitter(125, 0.25)); // ~94–156ms → ~6.4–10.6 req/s
    t.unref?.();
  };

  // Give the HTTP server a beat to be fully ready before the first request.
  const kickoff = setTimeout(tick, 250);
  kickoff.unref?.();
}
