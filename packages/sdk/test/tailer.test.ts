import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { OncallClient } from '../src/client.js';
import { parseLine, inferLevel, tailFile, tailStream } from '../src/tailer.js';

/** C3 `@oncall/sdk` tailer: line parsing + file/stdin tailing → batched client. */

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
function newClient(rec: Recorded) {
  return new OncallClient({
    apiKey: 'k',
    service: 'svc',
    fetchImpl: fakeFetch(rec),
    flushIntervalMs: 0,
    batchSize: 100_000,
  });
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe('parseLine / inferLevel', () => {
  it('maps a JSON log line to structured fields', () => {
    const e = parseLine(
      JSON.stringify({ level: 'error', message: 'boom', endpoint: '/x', status: 500, latency_ms: 12 }),
      'svc',
    );
    expect(e).toMatchObject({ level: 'error', message: 'boom', endpoint: '/x', status: 500, latency_ms: 12, service: 'svc' });
  });

  it('treats plain text as a message with an inferred level', () => {
    expect(parseLine('ERROR: something failed', 'svc')).toMatchObject({ level: 'error', message: 'ERROR: something failed' });
    expect(parseLine('just a normal line')).toMatchObject({ level: 'info' });
    expect(parseLine('   ')).toBeNull();
  });

  it('infers levels from keywords', () => {
    expect(inferLevel('a fatal exception')).toBe('error');
    expect(inferLevel('WARNING low disk')).toBe('warn');
    expect(inferLevel('debug trace here')).toBe('debug');
    expect(inferLevel('hello world')).toBe('info');
  });

  it('falls back to text on malformed JSON', () => {
    const e = parseLine('{ oops not json', 'svc');
    expect(e).toMatchObject({ level: 'info', message: '{ oops not json' });
  });
});

describe('tailFile', () => {
  it('reads existing content with fromStart and picks up appends', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oncall-tail-'));
    tmpDirs.push(dir);
    const file = join(dir, 'app.log');
    writeFileSync(file, 'line one\n{"level":"error","message":"boom"}\n');

    const rec: Recorded = { events: [] };
    const client = newClient(rec);
    const handle = tailFile(file, { client, fromStart: true, pollIntervalMs: 20 });

    await vi.waitFor(() => expect(client.pending).toBe(2), { timeout: 2000 });
    appendFileSync(file, 'another ERROR happened\n');
    await vi.waitFor(() => expect(client.pending).toBe(3), { timeout: 2000 });

    handle.stop();
    await client.flush();
    expect(rec.events).toHaveLength(3);
    expect(rec.events[1]).toMatchObject({ level: 'error', message: 'boom' });
    expect(rec.events[2]).toMatchObject({ level: 'error' });
  });

  it('does not replay existing content without fromStart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oncall-tail-'));
    tmpDirs.push(dir);
    const file = join(dir, 'app.log');
    writeFileSync(file, 'old line\n');

    const rec: Recorded = { events: [] };
    const client = newClient(rec);
    const handle = tailFile(file, { client, pollIntervalMs: 20 });
    await new Promise((r) => setTimeout(r, 80));
    expect(client.pending).toBe(0);
    appendFileSync(file, 'new line\n');
    await vi.waitFor(() => expect(client.pending).toBe(1), { timeout: 2000 });
    handle.stop();
  });
});

describe('tailStream', () => {
  it('ships each line from a readable stream', async () => {
    const rec: Recorded = { events: [] };
    const client = newClient(rec);
    const stream = new PassThrough();
    const handle = tailStream(stream, { client });
    stream.write('hello\n');
    stream.write('WARN disk almost full\n');
    stream.end();
    await vi.waitFor(() => expect(client.pending).toBe(2), { timeout: 2000 });
    handle.stop();
    await client.flush();
    expect(rec.events[0]).toMatchObject({ level: 'info', message: 'hello' });
    expect(rec.events[1]).toMatchObject({ level: 'warn' });
  });
});
