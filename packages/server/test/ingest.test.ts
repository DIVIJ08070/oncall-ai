import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openMemoryDatabase, type OncallDb } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createBroker, logsTopic, type Broker, type BrokerMessage } from '../src/sse/broker.js';
import { normalizeSignature } from '../src/ingest/fingerprint.js';

/**
 * C3 ingest API contract tests (SPEC §7.1) via Fastify `.inject()` — no live port.
 * Covers auth (401), batch validation (400), per-event partial rejection (202),
 * persistence + side effects (log_events, services.last_event_at, fingerprint_sig,
 * 8 KB stack truncation), and the `logs/<service>` broker publish.
 */

const KEY = 'test-ingest-key';

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

// `key: null` omits the header entirely (passing `undefined` would trigger the
// default and re-add the valid key). Default is the valid key.
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

describe('POST /api/v1/ingest — auth (SPEC §7.1)', () => {
  it('401 when the key header is missing', async () => {
    const res = await post({ events: [evt()] }, null);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('401 when the key is unknown', async () => {
    const res = await post({ events: [evt()] }, 'nope-not-a-key');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });
});

describe('POST /api/v1/ingest — batch validation (SPEC §7.1)', () => {
  it('400 validation_error when events is empty', async () => {
    const res = await post({ events: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('400 validation_error when events is missing', async () => {
    const res = await post({});
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('400 validation_error when the batch exceeds 500 events', async () => {
    const events = Array.from({ length: 501 }, () => evt());
    const res = await post({ events });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('400 validation_error on malformed JSON', async () => {
    const res = await post('{ not json ');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});

describe('POST /api/v1/ingest — 202 accept/reject (SPEC §7.1)', () => {
  it('accepts a valid batch and persists log_events', async () => {
    const res = await post({
      events: [
        evt({ level: 'error', message: 'boom', endpoint: '/api/checkout', method: 'POST', status: 500, latency_ms: 12 }),
        evt(),
      ],
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: 2, rejected: 0, errors: [] });

    const rows = ctx.db.dao.logEvents.query({ customer_id: ctx.customerId });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.received_at > 0)).toBe(true);
  });

  it('rejects invalid events per-index without failing the valid ones', async () => {
    const res = await post({
      events: [
        evt(),
        { service: 'checkout-api', level: 'info' }, // missing message
        evt({ level: 'nope' }), // invalid level
      ],
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(2);
    expect(body.errors.map((e: { index: number }) => e.index)).toEqual([1, 2]);
    expect(body.errors[0].message).toBeTypeOf('string');
    expect(ctx.db.dao.logEvents.query({ customer_id: ctx.customerId })).toHaveLength(1);
  });

  it('defaults timestamp to server receive time when omitted', async () => {
    const before = Date.now();
    await post({ events: [evt()] }); // no timestamp
    const [row] = ctx.db.dao.logEvents.query({ customer_id: ctx.customerId });
    expect(row.timestamp).toBeGreaterThanOrEqual(before);
    expect(row.timestamp).toBe(row.received_at);
  });

  it('computes fingerprint_sig (normalized message signature §10.2)', async () => {
    const message = "Cannot read properties of undefined (reading 'name') req 12345";
    await post({ events: [evt({ level: 'error', message })] });
    const [row] = ctx.db.dao.logEvents.query({ customer_id: ctx.customerId });
    expect(row.fingerprint_sig).toBe(normalizeSignature(message));
    expect(row.fingerprint_sig).toContain('<n>'); // digits stripped
    expect(row.fingerprint_sig).toContain('<str>'); // quoted token stripped
  });

  it('truncates stack to 8 KB on write (SPEC §8)', async () => {
    const stack = 'x'.repeat(20_000);
    await post({ events: [evt({ level: 'error', message: 'boom', stack })] });
    const [row] = ctx.db.dao.logEvents.query({ customer_id: ctx.customerId });
    expect(Buffer.byteLength(row.stack ?? '', 'utf8')).toBeLessThanOrEqual(8 * 1024);
  });

  it('advances services.last_event_at to the latest event timestamp', async () => {
    const t1 = 1_752_000_000_000;
    const t2 = 1_752_000_005_000;
    await post({ events: [evt({ timestamp: t1 }), evt({ timestamp: t2 })] });
    const svc = ctx.db.dao.services.getByName(ctx.customerId, 'checkout-api');
    expect(svc?.last_event_at).toBe(t2);
    expect(svc?.first_event_at).toBe(t1);
  });
});

describe('POST /api/v1/ingest — SSE broker publish (SPEC §7.1 side effect)', () => {
  it('publishes each accepted event to logs/<service> (data sans customer_id)', async () => {
    const received: BrokerMessage[] = [];
    ctx.broker.subscribe(logsTopic('checkout-api'), (m) => received.push(m));

    await post({ events: [evt(), evt({ level: 'error', message: 'boom' })] });

    expect(received).toHaveLength(2);
    for (const m of received) {
      expect(m.event).toBe('log');
      const data = m.data as Record<string, unknown>;
      expect(data.service).toBe('checkout-api');
      expect(data).not.toHaveProperty('customer_id');
      expect(data).toHaveProperty('id');
    }
  });

  it('does not publish rejected events', async () => {
    const received: BrokerMessage[] = [];
    ctx.broker.subscribe(logsTopic('checkout-api'), (m) => received.push(m));
    await post({ events: [evt(), { service: 'checkout-api', level: 'info' }] });
    expect(received).toHaveLength(1);
  });
});

describe('GET /health (SPEC §7.8)', () => {
  it('returns 200 { status: "ok" }', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
