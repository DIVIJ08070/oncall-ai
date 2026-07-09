import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import { setActiveMode } from '../src/control.js';

/**
 * Smoke tests for the victim (SPEC §12). The telemetry shipper is fail-silent, so
 * with no platform listening these requests still succeed — proving the customer
 * request path is never blocked by observability (NFR-04).
 */
describe('victim app', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    setActiveMode('healthy');
    server?.close();
  });

  it('serves /health', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });

  it('exposes control endpoints (§7.7)', async () => {
    const set = await fetch(`${base}/__control/failure-mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'bad_deploy' }),
    });
    expect(set.status).toBe(200);
    expect((await set.json()).mode).toBe('bad_deploy');

    const state = await fetch(`${base}/__control/state`);
    expect(state.status).toBe(200);
    const body = await state.json();
    expect(body.mode).toBe('bad_deploy');
    expect('deployed_sha' in body).toBe(true);
  });

  it('rejects an unknown mode', async () => {
    const res = await fetch(`${base}/__control/failure-mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('healthy: checkout/reports/pricing all 200', async () => {
    setActiveMode('healthy');
    const checkout = await fetch(`${base}/api/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cart: { items: [{ sku: 'a', qty: 2, price: 5 }] } }),
    });
    expect(checkout.status).toBe(200);
    expect((await checkout.json()).item_count).toBe(1);

    const reports = await fetch(`${base}/api/reports`);
    expect(reports.status).toBe(200);

    const pricing = await fetch(`${base}/api/pricing`);
    expect(pricing.status).toBe(200);
  });

  it('bad_deploy: POST /api/checkout throws a null-ref 500', async () => {
    setActiveMode('bad_deploy');
    const res = await fetch(`${base}/api/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toMatch(/Cannot read properties of undefined/);
  });

  it('slow_db: GET /api/reports is slow (>1000ms)', async () => {
    setActiveMode('slow_db');
    const t0 = Date.now();
    const res = await fetch(`${base}/api/reports`);
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(elapsed).toBeGreaterThan(1000);
  }, 10_000);

  it('config_error: GET /api/pricing throws on a subset', async () => {
    setActiveMode('config_error');
    let errors = 0;
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`${base}/api/pricing`);
      if (res.status === 500) {
        errors++;
        expect((await res.json()).error.message).toMatch(/Missing config PRICING_TABLE/);
      } else {
        await res.json();
      }
    }
    expect(errors).toBeGreaterThan(0);
    setActiveMode('healthy');
  });
});
