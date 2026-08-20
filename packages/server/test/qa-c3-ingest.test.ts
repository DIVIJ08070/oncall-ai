import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openMemoryDatabase, type OncallDb } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  createBroker,
  logsTopic,
  type Broker,
  type BrokerMessage,
} from '../src/sse/broker.js';

/**
 * QA C3 — Ingestion API contract (SPEC §7.1, §7, §8, §10.2).
 * Spec-derived, independent of the developer's own ingest.test.ts. Exercised via
 * Fastify `.inject()` (no live port) + direct SQLite reads for every side effect.
 * Each test cites its TEST_CASES-C3 TC id.
 */

const KEY = 'qa-c3-key';

interface Ctx {
  app: FastifyInstance;
  db: OncallDb;
  broker: Broker;
  customerId: string;
}
let ctx: Ctx;

beforeEach(async () => {
  const db = openMemoryDatabase();
  const customer = db.dao.customers.create({ name: 'acme', ingest_api_key: KEY });
  const broker = createBroker();
  const config = loadConfig({ INGEST_API_KEY: KEY });
  const app = await buildApp({ config, db, broker });
  ctx = { app, db, broker, customerId: customer.id };
});

afterEach(async () => {
  await ctx.app.close();
  ctx.db.close();
});

/** POST helper. `key: null` omits the header entirely. */
function post(body: unknown, key: string | null = KEY) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== null) headers['x-ingest-key'] = key;
  return ctx.app.inject({
    method: 'POST',
    url: '/api/v1/ingest',
    headers,
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const evt = (over: Record<string, unknown> = {}) => ({
  service: 'checkout-api',
  level: 'info',
  message: 'GET /api/checkout 200',
  ...over,
});

const rowsFor = (customerId: string) =>
  ctx.db.dao.logEvents.query({ customer_id: customerId, limit: 500 });

// ── A. Auth (x-ingest-key) ────────────────────────────────────────────────
describe('A. auth', () => {
  it('TC-01 valid key → 202 accepted:1, row written', async () => {
    const res = await post({ events: [evt()] });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0, errors: [] });
    expect(rowsFor(ctx.customerId)).toHaveLength(1);
  });

  it('TC-02 missing key → 401 unauthorized, no rows', async () => {
    const res = await post({ events: [evt()] }, null);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
    expect(rowsFor(ctx.customerId)).toHaveLength(0);
  });

  it('TC-03 unknown key → 401 unauthorized, no rows', async () => {
    const res = await post({ events: [evt()] }, 'not-a-real-key');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
    expect(rowsFor(ctx.customerId)).toHaveLength(0);
  });

  it('TC-04 empty-string key → 401 unauthorized', async () => {
    const res = await post({ events: [evt()] }, '');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('TC-05 events land under the authenticated customer, not another', async () => {
    const other = ctx.db.dao.customers.create({
      name: 'globex',
      ingest_api_key: 'other-key',
    });
    const res = await post({ events: [evt()] }, 'other-key');
    expect(res.statusCode).toBe(202);
    expect(rowsFor(other.id)).toHaveLength(1);
    expect(rowsFor(ctx.customerId)).toHaveLength(0);
  });
});

// ── B. Batch envelope validation ──────────────────────────────────────────
describe('B. batch envelope', () => {
  it('TC-06 batch of 50 valid → accepted:50', async () => {
    const events = Array.from({ length: 50 }, (_, i) => evt({ message: `m${i}` }));
    const res = await post({ events });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ accepted: 50, rejected: 0 });
    expect(rowsFor(ctx.customerId)).toHaveLength(50);
  });

  it('TC-07 exactly 500 valid → accepted:500 (boundary)', async () => {
    const events = Array.from({ length: 500 }, (_, i) => evt({ message: `m${i}` }));
    const res = await post({ events });
    expect(res.statusCode).toBe(202);
    expect(res.json().accepted).toBe(500);
    expect(rowsFor(ctx.customerId)).toHaveLength(500);
  });

  it('TC-08 oversized batch (501) → 400 validation_error, no rows', async () => {
    const events = Array.from({ length: 501 }, (_, i) => evt({ message: `m${i}` }));
    const res = await post({ events });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
    expect(rowsFor(ctx.customerId)).toHaveLength(0);
  });

  it('TC-09 empty events array → 400 validation_error', async () => {
    const res = await post({ events: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('TC-10 missing events field → 400 validation_error', async () => {
    const res = await post({});
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('TC-11 events not an array → 400 validation_error', async () => {
    const res = await post({ events: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('TC-12 malformed JSON body → 400 validation_error (normalized body)', async () => {
    const res = await post('not json at all');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
    expect(res.json().error.code).toBe('validation_error');
  });
});

// ── C. Per-event field validation ─────────────────────────────────────────
describe('C. per-event validation', () => {
  it('TC-13 missing service rejected', async () => {
    const res = await post({ events: [{ level: 'info', message: 'x' }] });
    expect(res.json()).toMatchObject({ accepted: 0, rejected: 1 });
  });
  it('TC-14 missing level rejected', async () => {
    const res = await post({ events: [{ service: 's', message: 'x' }] });
    expect(res.json()).toMatchObject({ accepted: 0, rejected: 1 });
  });
  it('TC-15 missing message rejected', async () => {
    const res = await post({ events: [{ service: 's', level: 'info' }] });
    expect(res.json()).toMatchObject({ accepted: 0, rejected: 1 });
  });
  it('TC-16 invalid level value rejected (enum)', async () => {
    const res = await post({ events: [evt({ level: 'fatal' })] });
    expect(res.json()).toMatchObject({ accepted: 0, rejected: 1 });
  });
  it('TC-17 all four valid levels accepted', async () => {
    const res = await post({
      events: [
        evt({ level: 'debug', message: 'd' }),
        evt({ level: 'info', message: 'i' }),
        evt({ level: 'warn', message: 'w' }),
        evt({ level: 'error', message: 'e' }),
      ],
    });
    expect(res.json()).toMatchObject({ accepted: 4, rejected: 0 });
  });
  it('TC-18 minimal event (only service/level/message) accepted, optionals null', async () => {
    const res = await post({ events: [evt()] });
    expect(res.json().accepted).toBe(1);
    const [row] = rowsFor(ctx.customerId);
    expect(row.stack).toBeNull();
    expect(row.endpoint).toBeNull();
    expect(row.method).toBeNull();
    expect(row.status).toBeNull();
    expect(row.latency_ms).toBeNull();
  });
  it('TC-19 optional fields when present persist verbatim', async () => {
    const res = await post({
      events: [
        evt({
          level: 'error',
          message: 'boom',
          stack: 'TypeError: boom\n  at x',
          endpoint: '/api/checkout',
          method: 'POST',
          status: 500,
          latency_ms: 42,
        }),
      ],
    });
    expect(res.json().accepted).toBe(1);
    const [row] = rowsFor(ctx.customerId);
    expect(row.stack).toBe('TypeError: boom\n  at x');
    expect(row.endpoint).toBe('/api/checkout');
    expect(row.method).toBe('POST');
    expect(row.status).toBe(500);
    expect(row.latency_ms).toBe(42);
  });
});

// ── D. Partial-invalid batch ──────────────────────────────────────────────
describe('D. partial-invalid batch', () => {
  it('TC-20/21/22 3 valid + 2 invalid → 202 accepted:3 rejected:2, errors carry index, only valid persist', async () => {
    const res = await post({
      events: [
        evt({ message: 'ok-1' }), // 0 valid
        { service: 's', message: 'no-level' }, // 1 invalid
        evt({ message: 'ok-2' }), // 2 valid
        evt({ level: 'nope' }), // 3 invalid
        evt({ message: 'ok-3' }), // 4 valid
      ],
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(3);
    expect(body.rejected).toBe(2);
    expect(body.errors).toHaveLength(2);
    expect(body.errors.map((e: { index: number }) => e.index).sort()).toEqual([1, 3]);
    for (const e of body.errors) {
      expect(typeof e.index).toBe('number');
      expect(typeof e.message).toBe('string');
      expect(e.message.length).toBeGreaterThan(0);
    }
    const msgs = rowsFor(ctx.customerId).map((r) => r.message).sort();
    expect(msgs).toEqual(['ok-1', 'ok-2', 'ok-3']);
  });
});

// ── E. timestamp default / received_at ────────────────────────────────────
describe('E. timestamp', () => {
  it('TC-23 omitted timestamp defaults to ~server receive time', async () => {
    const before = Date.now();
    const res = await post({ events: [evt()] });
    const after = Date.now();
    expect(res.json().accepted).toBe(1);
    const [row] = rowsFor(ctx.customerId);
    expect(row.timestamp).toBeGreaterThanOrEqual(before - 1000);
    expect(row.timestamp).toBeLessThanOrEqual(after + 1000);
  });
  it('TC-24 provided timestamp preserved verbatim', async () => {
    const res = await post({ events: [evt({ timestamp: 1752000000000 })] });
    expect(res.json().accepted).toBe(1);
    expect(rowsFor(ctx.customerId)[0].timestamp).toBe(1752000000000);
  });
  it('TC-25 received_at always set to ~now', async () => {
    const before = Date.now();
    await post({ events: [evt({ timestamp: 1752000000000 })] });
    const after = Date.now();
    const [row] = rowsFor(ctx.customerId);
    expect(row.received_at).toBeGreaterThanOrEqual(before - 1000);
    expect(row.received_at).toBeLessThanOrEqual(after + 1000);
  });
});

// ── F. fingerprint_sig (§8/§10.2) — expected literals computed independently ─
describe('F. fingerprint_sig', () => {
  it('TC-26 row persisted with id prefix + fields', async () => {
    await post({ events: [evt({ level: 'error', message: 'boom' })] });
    const [row] = rowsFor(ctx.customerId);
    expect(row.id.startsWith('log_')).toBe(true);
    expect(row.customer_id).toBe(ctx.customerId);
    expect(row.service).toBe('checkout-api');
    expect(row.level).toBe('error');
    expect(row.message).toBe('boom');
  });

  it('TC-27 numbers→<n>, quoted→<str>, lowercase', async () => {
    await post({ events: [evt({ message: "Order 12345 failed for user 'alice'" })] });
    expect(rowsFor(ctx.customerId)[0].fingerprint_sig).toBe(
      'order <n> failed for user <str>',
    );
  });

  it('TC-27b uuid→<uuid>, hex→<hex>', async () => {
    await post({
      events: [
        evt({ message: 'session A1B2C3D4-E5F6-7890-ABCD-EF1234567890 at 0xDEADBEEF' }),
      ],
    });
    expect(rowsFor(ctx.customerId)[0].fingerprint_sig).toBe('session <uuid> at <hex>');
  });

  it('TC-28 messages differing only by variable data share a signature', async () => {
    await post({
      events: [
        evt({ message: 'user 123 not found' }),
        evt({ message: 'user 456 not found' }),
      ],
    });
    const sigs = rowsFor(ctx.customerId).map((r) => r.fingerprint_sig);
    expect(sigs[0]).toBe(sigs[1]);
    expect(sigs[0]).toBe('user <n> not found');
  });

  it('TC-29 genuinely different messages differ in signature', async () => {
    await post({
      events: [evt({ message: 'null deref' }), evt({ message: 'connection timeout' })],
    });
    const sigs = rowsFor(ctx.customerId).map((r) => r.fingerprint_sig);
    expect(sigs[0]).not.toBe(sigs[1]);
  });
});

// ── G. 8 KB stack truncation (§8) ─────────────────────────────────────────
describe('G. stack truncation', () => {
  it('TC-30 oversized stack truncated to ≤ 8 KB bytes', async () => {
    const bigStack = 'x'.repeat(20000); // 20 KB
    const res = await post({ events: [evt({ level: 'error', message: 'boom', stack: bigStack })] });
    expect(res.json().accepted).toBe(1);
    const [row] = rowsFor(ctx.customerId);
    expect(row.stack).not.toBeNull();
    expect(Buffer.byteLength(row.stack as string, 'utf8')).toBeLessThanOrEqual(8 * 1024);
  });
  it('TC-31 under-limit stack stored intact', async () => {
    const small = 'TypeError: boom\n  at handler (server.ts:10)';
    await post({ events: [evt({ level: 'error', message: 'boom', stack: small })] });
    expect(rowsFor(ctx.customerId)[0].stack).toBe(small);
  });
});

// ── H. services heartbeat (§7.1/§8) ───────────────────────────────────────
describe('H. services heartbeat', () => {
  it('TC-32 first event creates the service row with last_event_at', async () => {
    await post({ events: [evt({ service: 'svc-x', timestamp: 1000 })] });
    const svc = ctx.db.dao.services.getByName(ctx.customerId, 'svc-x');
    expect(svc).not.toBeNull();
    expect(svc!.last_event_at).toBe(1000);
    expect(svc!.first_event_at).toBe(1000);
  });
  it('TC-33 last_event_at advances to the max event time, never backwards', async () => {
    await post({ events: [evt({ service: 'svc-y', timestamp: 5000 })] });
    await post({ events: [evt({ service: 'svc-y', timestamp: 9000 })] });
    await post({ events: [evt({ service: 'svc-y', timestamp: 3000 })] }); // older
    const svc = ctx.db.dao.services.getByName(ctx.customerId, 'svc-y');
    expect(svc!.last_event_at).toBe(9000);
    expect(svc!.first_event_at).toBe(3000);
  });
});

// ── I. SSE publish to logs/<service> (§7.1) ───────────────────────────────
describe('I. broker publish', () => {
  it('TC-34 each stored event published to logs/<service>; payload is the LogEvent sans customer_id', async () => {
    const received: BrokerMessage[] = [];
    ctx.broker.subscribe(logsTopic('checkout-api'), (m) => received.push(m));
    await post({ events: [evt({ level: 'error', message: 'boom' })] });
    expect(received).toHaveLength(1);
    expect(received[0].event).toBe('log');
    const data = received[0].data as Record<string, unknown>;
    expect(data.service).toBe('checkout-api');
    expect(data.message).toBe('boom');
    expect(data.fingerprint_sig).toBe('boom');
    expect('customer_id' in data).toBe(false);
  });

  it('TC-35 a throwing subscriber never fails ingest', async () => {
    ctx.broker.subscribe(logsTopic('checkout-api'), () => {
      throw new Error('subscriber blew up');
    });
    const res = await post({ events: [evt()] });
    expect(res.statusCode).toBe(202);
    expect(res.json().accepted).toBe(1);
  });
});

// ── J. response shape / status contract ───────────────────────────────────
describe('J. contract shape', () => {
  it('TC-36 202 body has exactly accepted/rejected/errors', async () => {
    const res = await post({ events: [evt()] });
    expect(Object.keys(res.json()).sort()).toEqual(['accepted', 'errors', 'rejected']);
  });
  it('TC-37 error bodies use { error: { code, message } } with a documented code', async () => {
    const codes = new Set([
      'unauthorized',
      'forbidden',
      'not_found',
      'validation_error',
      'rate_limited',
      'upstream_error',
      'internal',
    ]);
    const a = (await post({ events: [evt()] }, null)).json(); // 401
    const b = (await post({ events: [] })).json(); // 400
    for (const body of [a, b]) {
      expect(typeof body.error.code).toBe('string');
      expect(typeof body.error.message).toBe('string');
      expect(codes.has(body.error.code)).toBe(true);
    }
  });
  it('TC-38 GET /health → 200 { status: "ok" }', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
