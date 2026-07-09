import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * SSE reply plumbing (SPEC §7 conventions). Frames are
 * `event: <type>\ndata: <json>\n\n` plus a `:heartbeat` comment every 15 s.
 *
 * `formatSseEvent` / `formatSseComment` are pure so the exact wire framing can be
 * unit-tested without a socket; `startSse` hijacks the Fastify reply, writes the
 * SSE headers, drives the heartbeat, and tears everything down when either side
 * of the connection closes.
 */

/** Serialize one named SSE event frame (SPEC §7 `event:`/`data:` framing). */
export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Serialize an SSE comment line (used for the `:heartbeat` keep-alive). */
export function formatSseComment(text: string): string {
  return `: ${text}\n\n`;
}

/** Default keep-alive cadence (SPEC §7 "a `:heartbeat` comment every 15s"). */
export const SSE_HEARTBEAT_MS = 15_000;

export interface SseChannel {
  /** Write a named event frame. No-op once closed. */
  event(event: string, data: unknown): void;
  /** Write a comment line (e.g. the heartbeat). No-op once closed. */
  comment(text: string): void;
  /** End the stream + stop the heartbeat. Idempotent. */
  close(): void;
  /** Register a callback fired once when the client disconnects. */
  onClose(cb: () => void): void;
  readonly closed: boolean;
}

export interface StartSseOptions {
  heartbeatMs?: number;
}

/**
 * Take over the raw socket for a Server-Sent-Events stream. The Fastify handler
 * must `return` immediately after calling this (the response is hijacked). The
 * caller drives `event()`/`comment()`; the channel closes itself on client
 * disconnect and on `close()`.
 */
export function startSse(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: StartSseOptions = {},
): SseChannel {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable proxy buffering so frames flush immediately.
    'X-Accel-Buffering': 'no',
  });
  // A leading comment opens the stream and flushes headers to the client.
  raw.write(formatSseComment('ok'));

  let closed = false;
  const closeCbs: Array<() => void> = [];

  const write = (chunk: string): void => {
    if (closed) return;
    try {
      raw.write(chunk);
    } catch {
      // Peer went away mid-write — treat as closed.
      close();
    }
  };

  const heartbeatMs = opts.heartbeatMs ?? SSE_HEARTBEAT_MS;
  const hb = setInterval(() => write(formatSseComment('heartbeat')), heartbeatMs);
  if (typeof hb.unref === 'function') hb.unref();

  function close(): void {
    if (closed) return;
    closed = true;
    clearInterval(hb);
    for (const cb of closeCbs.splice(0)) {
      try {
        cb();
      } catch {
        /* a teardown callback must never throw */
      }
    }
    try {
      raw.end();
    } catch {
      /* already ended */
    }
  }

  const onSocketClose = (): void => close();
  raw.on('close', onSocketClose);
  req.raw.on('close', onSocketClose);

  return {
    event: (event, data) => write(formatSseEvent(event, data)),
    comment: (text) => write(formatSseComment(text)),
    close,
    onClose: (cb) => {
      if (closed) cb();
      else closeCbs.push(cb);
    },
    get closed() {
      return closed;
    },
  };
}
