import { describe, it, expect } from 'vitest';
import { OncallClient } from '../src/client.js';
import { oncall } from '../src/middleware.js';
import { parseLine, inferLevel } from '../src/tailer.js';
import { parseArgs } from '../src/cli.js';

/**
 * QA C3 — `@oncall/sdk` contract (SPEC §3/§12; FR-02, NFR-04). Spec-derived,
 * independent of the developer's own sdk tests. The cardinal property is
 * fail-silent, non-blocking shipping: the client must NEVER throw or reject on a
 * transport failure. Each test cites its TEST_CASES-C3 TC id.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Records every fetch call; resolvable to any status. */
function recordingFetch(res: { ok?: boolean; status?: number } = { ok: true, status: 202 }) {
  const calls: { url: string; body: unknown; key?: string }[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    const i = init as { body?: string; headers?: Record<string, string> };
    calls.push({
      url: String(url),
      body: i?.body ? JSON.parse(i.body) : undefined,
      key: i?.headers?.['x-ingest-key'],
    });
    return { ok: res.ok ?? true, status: res.status ?? 202 } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const rejectingFetch = (async () => {
  throw new Error('ECONNREFUSED');
}) as unknown as typeof fetch;

// ── K. client: non-blocking, fail-silent (NFR-04) ─────────────────────────
describe('K. client fail-silent', () => {
  it('TC-39 capture() never throws with a rejecting transport', () => {
    const c = new OncallClient({
      apiKey: 'k',
      service: 's',
      fetchImpl: rejectingFetch,
      flushIntervalMs: 0,
    });
    expect(() => {
      for (let i = 0; i < 100; i++) c.capture({ level: 'error', message: `m${i}` });
    }).not.toThrow();
  });

  it('TC-40 flush() resolves (never rejects) when transport rejects; onError fired', async () => {
    const errors: unknown[] = [];
    const c = new OncallClient({
      apiKey: 'k',
      service: 's',
      fetchImpl: rejectingFetch,
      flushIntervalMs: 0,
      onError: (e) => errors.push(e),
    });
    c.capture({ level: 'error', message: 'boom' });
    await expect(c.flush()).resolves.toBeUndefined();
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('TC-41 non-2xx (500) is swallowed, surfaced via onError', async () => {
    const errors: unknown[] = [];
    const { impl } = recordingFetch({ ok: false, status: 500 });
    const c = new OncallClient({
      apiKey: 'k',
      service: 's',
      fetchImpl: impl,
      flushIntervalMs: 0,
      onError: (e) => errors.push(e),
    });
    c.capture({ level: 'info', message: 'x' });
    await expect(c.flush()).resolves.toBeUndefined();
    expect(String(errors[0])).toMatch(/500/);
  });

  it('TC-42 flush splits into ≤500-event requests', async () => {
    const { impl, calls } = recordingFetch();
    const c = new OncallClient({
      apiKey: 'k',
      service: 's',
      fetchImpl: impl,
      flushIntervalMs: 0,
      batchSize: 100000, // prevent auto-flush so we control batching
      maxQueue: 100000,
    });
    for (let i = 0; i < 1200; i++) c.capture({ level: 'info', message: `m${i}` });
    await c.flush();
    expect(calls.length).toBe(3); // ceil(1200/500)
    const sizes = calls.map((call) => (call.body as { events: unknown[] }).events.length);
    expect(sizes).toEqual([500, 500, 200]);
    for (const call of calls) {
      expect((call.body as { events: unknown[] }).events.length).toBeLessThanOrEqual(500);
      expect(call.key).toBe('k');
    }
  });

  it('TC-43 timer auto-flushes without explicit flush()', async () => {
    const { impl, calls } = recordingFetch();
    const c = new OncallClient({
      apiKey: 'k',
      service: 's',
      fetchImpl: impl,
      flushIntervalMs: 20,
      batchSize: 100000,
    });
    c.capture({ level: 'info', message: 'x' });
    await sleep(120);
    await c.close();
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('TC-44 bounded queue drops OLDEST past maxQueue (no throw, no growth)', async () => {
    const { impl, calls } = recordingFetch();
    const c = new OncallClient({
      apiKey: 'k',
      service: 's',
      fetchImpl: impl,
      flushIntervalMs: 0,
      batchSize: 100000, // never auto-flush
      maxQueue: 5,
    });
    for (let i = 0; i < 100; i++) c.capture({ level: 'info', message: `m${i}` });
    expect(c.pending).toBe(5);
    await c.flush();
    const sent = (calls[0].body as { events: { message: string }[] }).events.map((e) => e.message);
    expect(sent).toEqual(['m95', 'm96', 'm97', 'm98', 'm99']); // oldest dropped
  });

  it('TC-45 close() resolves with pending events + failing transport', async () => {
    const c = new OncallClient({
      apiKey: 'k',
      service: 's',
      fetchImpl: rejectingFetch,
      flushIntervalMs: 0,
    });
    c.capture({ level: 'error', message: 'boom' });
    await expect(c.close()).resolves.toBeUndefined();
  });
});

// ── L. middleware ─────────────────────────────────────────────────────────
describe('L. middleware', () => {
  function fakeRes(statusCode: number) {
    const listeners: Record<string, (() => void)[]> = {};
    return {
      statusCode,
      on(ev: string, fn: () => void) {
        (listeners[ev] ??= []).push(fn);
        return this;
      },
      fire(ev: string) {
        (listeners[ev] ?? []).forEach((fn) => fn());
      },
    };
  }

  it('TC-47 express middleware emits one info event with request fields', async () => {
    const { impl, calls } = recordingFetch();
    const client = new OncallClient({ apiKey: 'k', service: 'checkout-api', fetchImpl: impl, flushIntervalMs: 0 });
    const mw = oncall({ apiKey: 'k', service: 'checkout-api', client });
    const req = { method: 'POST', originalUrl: '/api/checkout?x=1' };
    const res = fakeRes(200);
    let nextCalled = false;
    mw(req as never, res as never, () => (nextCalled = true));
    expect(nextCalled).toBe(true);
    res.fire('finish');
    await client.flush();
    const ev = (calls[0].body as { events: Record<string, unknown>[] }).events[0];
    expect(ev.level).toBe('info');
    expect(ev.endpoint).toBe('/api/checkout'); // query stripped
    expect(ev.method).toBe('POST');
    expect(ev.status).toBe(200);
    expect(typeof ev.latency_ms).toBe('number');
  });

  it('TC-48 errorHandler emits an error event with message + stack', async () => {
    const { impl, calls } = recordingFetch();
    const client = new OncallClient({ apiKey: 'k', service: 'checkout-api', fetchImpl: impl, flushIntervalMs: 0 });
    const mw = oncall({ apiKey: 'k', service: 'checkout-api', client });
    const req = { method: 'GET', originalUrl: '/api/pricing' };
    const res = fakeRes(500);
    let propagated = false;
    mw.errorHandler(new Error('kaboom'), req as never, res as never, () => (propagated = true));
    expect(propagated).toBe(true); // error still propagates to the app
    await client.flush();
    const ev = (calls[0].body as { events: Record<string, unknown>[] }).events[0];
    expect(ev.level).toBe('error');
    expect(ev.message).toBe('kaboom');
    expect(String(ev.stack)).toMatch(/kaboom/);
    expect(ev.status).toBe(500);
  });
});

// ── L. tailer + CLI ───────────────────────────────────────────────────────
describe('L. tailer + cli', () => {
  it('TC-49 parseLine maps a JSON log line to structured fields', () => {
    const ev = parseLine(
      '{"level":"warn","message":"disk low","endpoint":"/x","method":"GET","status":503,"latency_ms":12}',
      'svc',
    );
    expect(ev).not.toBeNull();
    expect(ev).toMatchObject({
      level: 'warn',
      message: 'disk low',
      endpoint: '/x',
      method: 'GET',
      status: 503,
      latency_ms: 12,
      service: 'svc',
    });
  });

  it('TC-50 plain text infers a level', () => {
    expect(parseLine('ERROR checkout exploded', 'svc')).toMatchObject({
      level: 'error',
      message: 'ERROR checkout exploded',
    });
    expect(inferLevel('this is a warning')).toBe('warn');
    expect(inferLevel('just some info line')).toBe('info');
    expect(parseLine('   ', 'svc')).toBeNull(); // blank line skipped
  });

  it('TC-51 oncall-tail CLI parses its flags', () => {
    const args = parseArgs([
      '--file', 'app.log',
      '--service', 'checkout-api',
      '--key', 'k',
      '--url', 'http://localhost:3011/api/v1/ingest',
      '--from-start',
      '--batch', '25',
      '--interval', '1000',
    ]);
    expect(args).toMatchObject({
      file: 'app.log',
      service: 'checkout-api',
      key: 'k',
      url: 'http://localhost:3011/api/v1/ingest',
      fromStart: true,
      batch: 25,
      interval: 1000,
    });
  });
});
