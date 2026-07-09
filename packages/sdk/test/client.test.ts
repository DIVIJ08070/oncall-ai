import { describe, it, expect, vi } from 'vitest';
import { OncallClient, MAX_EVENTS_PER_REQUEST } from '../src/client.js';

/**
 * C3 `@oncall/sdk` client contract (NFR-04): batched, non-blocking, fail-silent.
 * A fake `fetch` records requests; failure fetches verify nothing ever throws.
 */

interface Recorded {
  url: string;
  headers: Record<string, string>;
  events: unknown[];
}

function fakeFetch(record: Recorded[], ok = true, status = 202) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init.body)) as { events: unknown[] };
    record.push({ url, headers, events: body.events });
    return { ok, status } as Response;
  }) as unknown as typeof fetch;
}

const opts = (over = {}) => ({
  apiKey: 'k1',
  service: 'checkout-api',
  ingestUrl: 'http://localhost:3001/api/v1/ingest',
  flushIntervalMs: 0, // disable timer; drive flushes explicitly
  ...over,
});

describe('OncallClient — batching', () => {
  it('captures without sending until flush(), then POSTs one batch', async () => {
    const rec: Recorded[] = [];
    const c = new OncallClient(opts({ fetchImpl: fakeFetch(rec), batchSize: 100 }));
    c.capture({ level: 'info', message: 'a' });
    c.capture({ level: 'warn', message: 'b' });
    c.capture({ level: 'error', message: 'c' });
    expect(rec).toHaveLength(0); // nothing sent yet
    expect(c.pending).toBe(3);

    await c.flush();
    expect(rec).toHaveLength(1);
    expect(rec[0].events).toHaveLength(3);
    expect(rec[0].url).toBe('http://localhost:3001/api/v1/ingest');
    expect(rec[0].headers['x-ingest-key']).toBe('k1');
    expect(c.pending).toBe(0);
  });

  it('stamps default service + timestamp and matches the wire shape', async () => {
    const rec: Recorded[] = [];
    const c = new OncallClient(opts({ fetchImpl: fakeFetch(rec) }));
    c.capture({ level: 'info', message: 'hi' });
    await c.flush();
    const e = rec[0].events[0] as Record<string, unknown>;
    expect(e.service).toBe('checkout-api');
    expect(typeof e.timestamp).toBe('number');
    expect(e.level).toBe('info');
    expect(e.message).toBe('hi');
    expect(e.stack).toBeNull();
  });

  it('auto-flushes when the batch fills (batchSize threshold)', async () => {
    const rec: Recorded[] = [];
    const c = new OncallClient(opts({ fetchImpl: fakeFetch(rec), batchSize: 3 }));
    c.capture({ level: 'info', message: '1' });
    c.capture({ level: 'info', message: '2' });
    c.capture({ level: 'info', message: '3' }); // triggers flush
    await vi.waitFor(() => expect(rec).toHaveLength(1));
    expect(rec[0].events).toHaveLength(3);
  });

  it('splits into ≤500-event requests', async () => {
    const rec: Recorded[] = [];
    const c = new OncallClient(opts({ fetchImpl: fakeFetch(rec), batchSize: 100_000 }));
    for (let i = 0; i < MAX_EVENTS_PER_REQUEST + 1; i++) {
      c.capture({ level: 'info', message: String(i) });
    }
    await c.flush();
    expect(rec).toHaveLength(2);
    expect(rec[0].events).toHaveLength(MAX_EVENTS_PER_REQUEST);
    expect(rec[1].events).toHaveLength(1);
  });

  it('bounds memory: drops oldest beyond maxQueue', async () => {
    const rec: Recorded[] = [];
    const c = new OncallClient(opts({ fetchImpl: fakeFetch(rec), batchSize: 100_000, maxQueue: 5 }));
    for (let i = 0; i < 20; i++) c.capture({ level: 'info', message: String(i) });
    expect(c.pending).toBe(5);
    await c.flush();
    const msgs = (rec[0].events as Array<{ message: string }>).map((e) => e.message);
    expect(msgs).toEqual(['15', '16', '17', '18', '19']); // newest kept
  });
});

describe('OncallClient — fail-silent (NFR-04)', () => {
  it('never throws from capture() and flush() when the transport rejects', async () => {
    const onError = vi.fn();
    const rejecting = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const c = new OncallClient(opts({ fetchImpl: rejecting, onError, batchSize: 100 }));

    expect(() => c.capture({ level: 'error', message: 'x' })).not.toThrow();
    await expect(c.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(c.pending).toBe(0); // dropped after send attempt (best-effort)
  });

  it('reports non-2xx responses via onError without throwing', async () => {
    const onError = vi.fn();
    const rec: Recorded[] = [];
    const c = new OncallClient(
      opts({ fetchImpl: fakeFetch(rec, false, 500), onError, batchSize: 100 }),
    );
    c.capture({ level: 'error', message: 'x' });
    await expect(c.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('flush() on an empty queue is a no-op', async () => {
    const rec: Recorded[] = [];
    const c = new OncallClient(opts({ fetchImpl: fakeFetch(rec) }));
    await expect(c.flush()).resolves.toBeUndefined();
    expect(rec).toHaveLength(0);
  });

  it('close() stops the client and flushes remaining events', async () => {
    const rec: Recorded[] = [];
    const c = new OncallClient(opts({ fetchImpl: fakeFetch(rec), flushIntervalMs: 50, batchSize: 100 }));
    c.capture({ level: 'info', message: 'last' });
    await c.close();
    expect(rec).toHaveLength(1);
    // captures after close are ignored
    c.capture({ level: 'info', message: 'ignored' });
    expect(c.pending).toBe(0);
  });
});
