import { createInterface } from 'node:readline';
import { open, stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type { LogLevel } from '@oncall/shared';
import type { OncallClient, OncallEventInput } from './client.js';

/**
 * File / stdout tailer (SPEC §3, §12; FR-02) — ships logs with **no app code
 * changes**. Each appended line is parsed (JSON line → structured fields; plain
 * text → message with a level inferred from keywords) and handed to the batched
 * fail-silent {@link OncallClient}. Backs the `oncall-tail` CLI.
 */

export interface TailerOptions {
  client: OncallClient;
  /** Overrides the client's default service for tailed events. */
  service?: string;
  /** Read the file from the beginning (default: only new appends). */
  fromStart?: boolean;
  /** File poll cadence in ms. Default 400. */
  pollIntervalMs?: number;
}

export interface TailHandle {
  /** Stop tailing and release resources. Idempotent. */
  stop(): void;
}

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function isLevel(v: unknown): v is LogLevel {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
}

/** Infer a level from a plain-text line (best-effort). */
export function inferLevel(line: string): LogLevel {
  if (/\b(error|fatal|exception|panic|err)\b/i.test(line)) return 'error';
  if (/\bwarn(ing)?\b/i.test(line)) return 'warn';
  if (/\bdebug\b/i.test(line)) return 'debug';
  return 'info';
}

/**
 * Parse one raw log line into an ingest event. JSON objects are mapped field by
 * field (level/message/msg/endpoint/method/status/latency/stack/timestamp);
 * everything else becomes a text message with an inferred level.
 */
export function parseLine(
  line: string,
  service?: string,
): OncallEventInput | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const o = JSON.parse(trimmed) as Record<string, unknown>;
      const message =
        (typeof o.message === 'string' && o.message) ||
        (typeof o.msg === 'string' && o.msg) ||
        trimmed;
      const level = isLevel(o.level) ? o.level : inferLevel(message);
      const num = (v: unknown): number | null =>
        typeof v === 'number' ? v : v == null ? null : Number(v) || null;
      return {
        level,
        message,
        service,
        timestamp: typeof o.timestamp === 'number' ? o.timestamp : undefined,
        endpoint: typeof o.endpoint === 'string' ? o.endpoint : null,
        method: typeof o.method === 'string' ? o.method : null,
        status: num(o.status),
        latency_ms: num(o.latency_ms ?? o.latency),
        stack: typeof o.stack === 'string' ? o.stack : null,
      };
    } catch {
      // fall through to plain-text handling on malformed JSON
    }
  }

  return { level: inferLevel(trimmed), message: trimmed, service };
}

/** Tail a readable stream (e.g. `process.stdin`) line by line. */
export function tailStream(
  readable: Readable,
  opts: TailerOptions,
): TailHandle {
  const rl = createInterface({ input: readable, crlfDelay: Infinity });
  const onLine = (line: string) => {
    const ev = parseLine(line, opts.service);
    if (ev) opts.client.capture(ev);
  };
  rl.on('line', onLine);
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      rl.off('line', onLine);
      rl.close();
    },
  };
}

/**
 * Tail a file, shipping appended lines. Handles truncation/rotation (offset
 * reset) and partial trailing lines (buffered until the newline arrives).
 */
export function tailFile(path: string, opts: TailerOptions): TailHandle {
  const pollMs = Math.max(50, opts.pollIntervalMs ?? 400);
  let offset = -1; // uninitialized
  let buffer = '';
  let stopped = false;
  let running = false;

  const emit = (line: string) => {
    const ev = parseLine(line, opts.service);
    if (ev) opts.client.capture(ev);
  };

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const st = await stat(path).catch(() => null);
      if (!st) return; // file not present yet — retry next tick
      if (offset < 0) {
        offset = opts.fromStart ? 0 : st.size;
        return;
      }
      if (st.size < offset) {
        // truncated or rotated — restart from the top
        offset = 0;
        buffer = '';
      }
      if (st.size === offset) return;

      const length = st.size - offset;
      const buf = Buffer.alloc(length);
      const fh = await open(path, 'r');
      try {
        await fh.read(buf, 0, length, offset);
      } finally {
        await fh.close();
      }
      offset = st.size;
      buffer += buf.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) emit(line);
    } catch {
      // fail-silent: a transient read error must not crash the tailer
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), pollMs);
  timer.unref?.();
  // Kick immediately so `fromStart` picks up existing content promptly.
  void tick();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}
