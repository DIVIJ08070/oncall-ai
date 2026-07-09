import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import {
  FailureModeRequestSchema,
  FailureModeSchema,
  type FailureMode,
} from '@oncall/shared';
import { currentCustomer } from '../github/session.js';
import { sendError } from '../http/errors.js';

/**
 * Demo control plane (SPEC §7.7, §12) — the platform side of the FailureModeSwitch
 * + TrafficGenerator (DESIGN_SPEC §6.4/§8.8, C15). The dashboard talks only to the
 * platform (same-origin via the Vite `/api` proxy), so these routes are the CORS-
 * clean bridge to the victim app (which has no CORS of its own):
 *
 *   POST /api/v1/demo/failure-mode  { mode }  -> 200 { mode, deployed_sha }
 *     (a) flips the victim via `POST /__control/failure-mode`;
 *     (b) records/marks-current the `deploys` row for the mode's real bad SHA so
 *         `get_recent_deploys` / `get_deploy_diff` return correlated data (§7.7).
 *   GET  /api/v1/demo/state                    -> 200 { mode, deployed_sha }
 *     proxies the victim `GET /__control/state` so the readout binds through the
 *     platform (browser → victim:4000 would be cross-origin).
 *   POST /api/v1/demo/traffic       { count?, target? } -> 200 { sent, ok, failed, target }
 *     server-side traffic burst at the victim so the browser TrafficGenerator can
 *     drive real load (and the 15s detector) without CORS.
 *
 * `deployed_sha` is read back from the victim's own `/__control/state` after the
 * flip, keeping the field authoritative and unified across both endpoints (§7.7,
 * DESIGN BUG-004).
 */

const ALL_MODES: readonly FailureMode[] = FailureModeSchema.options;
const FAILING_MODES: readonly FailureMode[] = ['bad_deploy', 'slow_db', 'config_error'];

/** Victim business endpoints, one per failure mode + a healthy baseline path. */
const VICTIM_ENDPOINTS: Record<string, { method: string; path: string }> = {
  checkout: { method: 'POST', path: '/api/checkout' }, // bad_deploy target
  reports: { method: 'GET', path: '/api/reports' }, //    slow_db target
  pricing: { method: 'GET', path: '/api/pricing' }, //    config_error target
  health: { method: 'GET', path: '/health' }, //          healthy baseline
};

const MIX_ROTATION = ['checkout', 'reports', 'pricing'] as const;

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.round(n), min), max);
}

interface VictimState {
  mode: FailureMode;
  deployed_sha: string | null;
}

export function registerDemoRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const victimBase = config.victim.controlUrl.replace(/\/+$/, '');
  const offline = (): string =>
    `Could not reach the victim app on ${victimBase} — start it with ` +
    '`npm run --workspace oncall-ai-victim dev`';

  async function readVictimState(): Promise<VictimState | null> {
    try {
      const res = await fetch(`${victimBase}/__control/state`);
      if (!res.ok) return null;
      const j = (await res.json()) as Partial<VictimState>;
      if (typeof j.mode !== 'string') return null;
      return { mode: j.mode as FailureMode, deployed_sha: j.deployed_sha ?? null };
    } catch {
      return null;
    }
  }

  // POST /api/v1/demo/failure-mode — flip the victim + record the deploy row.
  app.post('/api/v1/demo/failure-mode', async (req, reply) => {
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to control the demo');
    }

    const parsed = FailureModeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        'validation_error',
        `mode must be one of: ${ALL_MODES.join(', ')}`,
      );
    }
    const { mode } = parsed.data;

    // (a) flip the victim's in-memory failure switch.
    let flipped = false;
    try {
      const res = await fetch(`${victimBase}/__control/failure-mode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      flipped = res.ok;
    } catch {
      flipped = false;
    }
    if (!flipped) {
      return sendError(reply, 502, 'upstream_error', offline());
    }

    // (b) read the authoritative deployed SHA the victim maps this mode to.
    const state = await readVictimState();
    const deployed_sha = state?.deployed_sha ?? null;

    // (c) correlate git history with runtime: mark the mode's SHA current so the
    // agent's get_recent_deploys/get_deploy_diff tools return real data (§7.7).
    if (deployed_sha) {
      const existing = db.dao.deploys.getBySha(customer.id, deployed_sha);
      if (existing) {
        db.dao.deploys.markCurrent(customer.id, deployed_sha);
      } else {
        // Unseeded SHA — insert a minimal correlated row, then mark it current.
        db.dao.deploys.upsert({
          customer_id: customer.id,
          sha: deployed_sha,
          short_sha: deployed_sha.slice(0, 7),
          ref: 'refs/heads/main',
          message: `demo control → ${mode}`,
          author: 'demo-control',
          committed_at: Date.now(),
          source: FAILING_MODES.includes(mode) ? 'bad_deploy' : 'baseline',
          is_current: true,
        });
        db.dao.deploys.markCurrent(customer.id, deployed_sha);
      }
    }

    return reply.code(200).send({ mode, deployed_sha });
  });

  // GET /api/v1/demo/state — proxy the victim's current mode + deployed_sha.
  app.get('/api/v1/demo/state', async (req, reply) => {
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to view demo state');
    }
    const state = await readVictimState();
    if (!state) {
      return sendError(reply, 502, 'upstream_error', offline());
    }
    return reply.code(200).send(state);
  });

  // POST /api/v1/demo/traffic — server-side burst at the victim (CORS-free load).
  app.post('/api/v1/demo/traffic', async (req, reply) => {
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to drive demo traffic');
    }

    const body = (req.body ?? {}) as { count?: unknown; target?: unknown };
    const count = clampInt(body.count, 1, 60, 10);
    const rawTarget = typeof body.target === 'string' ? body.target : 'mix';
    const target =
      rawTarget in VICTIM_ENDPOINTS || rawTarget === 'mix' ? rawTarget : 'mix';

    // Build the request plan: a fixed endpoint repeated, or a round-robin mix.
    const plan: { method: string; path: string }[] = [];
    for (let i = 0; i < count; i++) {
      const key = target === 'mix' ? MIX_ROTATION[i % MIX_ROTATION.length] : target;
      plan.push(VICTIM_ENDPOINTS[key]);
    }

    // Fire concurrently but capped — slow_db (reports) requests take 2–4s each,
    // so bounded concurrency keeps a burst from pinning the event loop.
    const CONCURRENCY = 8;
    let ok = 0;
    let failed = 0;
    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < plan.length) {
        const ep = plan[cursor++];
        try {
          await fetch(`${victimBase}${ep.path}`, {
            method: ep.method,
            headers: ep.method === 'POST' ? { 'content-type': 'application/json' } : undefined,
            body: ep.method === 'POST' ? JSON.stringify({ demo: true }) : undefined,
          });
          // A 5xx from the failing endpoint is the *point* of the demo — it is a
          // completed request the victim reports to /ingest, so it counts as `ok`
          // (reached the victim). Only network/transport errors count as `failed`.
          ok++;
        } catch {
          failed++;
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, plan.length) }, () => worker()),
    );

    return reply.code(200).send({ sent: plan.length, ok, failed, target });
  });
}
