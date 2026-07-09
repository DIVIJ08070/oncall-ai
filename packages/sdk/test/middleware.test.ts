import { describe, it, expect, vi } from 'vitest';
import { oncall, oncallFastify } from '../src/middleware.js';

/**
 * C3 `@oncall/sdk` middleware: one `info` per request (endpoint/method/status/
 * latency) + one `error` per failure (message/stack), shipped via the batched
 * fail-silent client (SPEC §12).
 */

interface Recorded {
  events: Array<Record<string, unknown>>;
}
function fakeFetch(rec: Recorded) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { events: Record<string, unknown>[] };
    rec.events.push(...body.events);
    return { ok: true, status: 202 } as Response;
  }) as unknown as typeof fetch;
}

/* ── minimal Express doubles ─────────────────────────────────────────────── */
function fakeRes(statusCode = 200) {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    statusCode,
    on(ev: string, cb: () => void) {
      (listeners[ev] ??= []).push(cb);
    },
    emit(ev: string) {
      (listeners[ev] ?? []).forEach((f) => f());
    },
  };
}

describe('oncall() Express request telemetry', () => {
  it('emits an info event with endpoint/method/status/latency on finish', async () => {
    const rec: Recorded = { events: [] };
    const mw = oncall({ apiKey: 'k', service: 'svc', fetchImpl: fakeFetch(rec), flushIntervalMs: 0 });
    const req = { method: 'POST', originalUrl: '/api/checkout?token=1' };
    const res = fakeRes(200);
    let nextCalled = false;
    mw(req, res as never, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true); // never blocks the request
    res.emit('finish');
    await mw.client.flush();

    expect(rec.events).toHaveLength(1);
    const e = rec.events[0];
    expect(e.level).toBe('info');
    expect(e.endpoint).toBe('/api/checkout'); // query stripped
    expect(e.method).toBe('POST');
    expect(e.status).toBe(200);
    expect(typeof e.latency_ms).toBe('number');
  });
});

describe('oncall().errorHandler Express error telemetry', () => {
  it('emits an error event with message + stack and re-throws to next', async () => {
    const rec: Recorded = { events: [] };
    const mw = oncall({ apiKey: 'k', service: 'svc', fetchImpl: fakeFetch(rec), flushIntervalMs: 0 });
    const req = { method: 'GET', originalUrl: '/api/pricing' };
    const res = fakeRes(500);
    const err = new Error('Missing config PRICING_TABLE');
    let passed: unknown;
    mw.errorHandler(err, req, res as never, (e) => {
      passed = e;
    });
    await mw.client.flush();

    expect(passed).toBe(err); // error still propagates
    expect(rec.events).toHaveLength(1);
    const e = rec.events[0];
    expect(e.level).toBe('error');
    expect(e.message).toBe('Missing config PRICING_TABLE');
    expect(typeof e.stack).toBe('string');
    expect(e.status).toBe(500);
  });
});

describe('oncallFastify plugin', () => {
  it('registers onResponse + onError hooks that ship telemetry', async () => {
    const rec: Recorded = { events: [] };
    const hooks: Record<string, Function> = {};
    let client: { flush(): Promise<void> } | undefined;
    const app = {
      addHook(name: string, fn: Function) {
        hooks[name] = fn;
      },
      decorate(name: string, value: unknown) {
        if (name === 'oncall') client = value as { flush(): Promise<void> };
      },
    };
    let doneCalled = false;
    oncallFastify(app as never, { apiKey: 'k', service: 'svc', fetchImpl: fakeFetch(rec), flushIntervalMs: 0 }, () => {
      doneCalled = true;
    });
    expect(doneCalled).toBe(true);
    expect(hooks.onResponse).toBeTypeOf('function');
    expect(hooks.onError).toBeTypeOf('function');
    expect(client).toBeDefined();

    hooks.onResponse({ method: 'GET', url: '/api/reports?x=1' }, { statusCode: 200, elapsedTime: 3.7 });
    hooks.onError(
      { method: 'POST', url: '/api/checkout' },
      { statusCode: 500 },
      new Error('TypeError: undefined name'),
    );
    await client!.flush();

    expect(rec.events).toHaveLength(2);
    const info = rec.events.find((e) => e.level === 'info')!;
    expect(info.endpoint).toBe('/api/reports');
    expect(info.latency_ms).toBe(4); // rounded from 3.7
    const error = rec.events.find((e) => e.level === 'error')!;
    expect(error.message).toBe('TypeError: undefined name');
    expect(error.status).toBe(500);
  });
});
