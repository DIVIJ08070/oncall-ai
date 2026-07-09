import type { LogLevel } from '@oncall/shared';

/**
 * `@oncall/sdk` batched log-shipping client (SPEC §3, §12; FR-02, NFR-04).
 *
 * Design contract:
 *  - **Non-blocking:** `capture()` only enqueues in memory and returns
 *    immediately — it never awaits the network and never throws.
 *  - **Batched:** events are POSTed to `POST /api/v1/ingest` in batches (flushed
 *    on a timer, when the batch fills, or on explicit `flush()`).
 *  - **Fail-silent (NFR-04):** transport/serialization failures are swallowed
 *    (optionally surfaced through `onError`) so the host app is never impacted by
 *    the observability path. The queue is bounded so a dead collector cannot leak
 *    memory — oldest events are dropped past `maxQueue`.
 *
 * The wire shape matches `@oncall/shared` `LogEventInputSchema` exactly (SPEC §7.1).
 */

/** A single event as supplied by the host app. `service` defaults to the client's. */
export interface OncallEventInput {
  timestamp?: number;
  service?: string;
  level: LogLevel;
  message: string;
  stack?: string | null;
  endpoint?: string | null;
  method?: string | null;
  status?: number | null;
  latency_ms?: number | null;
}

/** Fully-resolved event placed on the send queue (matches the ingest wire event). */
export interface OncallWireEvent {
  timestamp: number;
  service: string;
  level: LogLevel;
  message: string;
  stack?: string | null;
  endpoint?: string | null;
  method?: string | null;
  status?: number | null;
  latency_ms?: number | null;
}

export interface OncallClientOptions {
  /** Per-customer ingest key sent as `x-ingest-key` (FR-01). */
  apiKey: string;
  /** Default service name stamped on events that omit one. */
  service: string;
  /** Ingest endpoint. Default `http://localhost:3001/api/v1/ingest`. */
  ingestUrl?: string;
  /** Flush when this many events are queued. Default 50 (server cap is 500). */
  batchSize?: number;
  /** Auto-flush cadence in ms. Default 2000. `0` disables the timer. */
  flushIntervalMs?: number;
  /** Max buffered events before the oldest are dropped. Default 10000. */
  maxQueue?: number;
  /** Per-request timeout in ms. Default 5000 (NFR-05 ≤5s ingest budget). */
  timeoutMs?: number;
  /** Injectable fetch (tests / non-global-fetch runtimes). Default global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Optional error sink; if absent, transport errors are silently swallowed. */
  onError?: (err: unknown) => void;
}

const DEFAULTS = {
  ingestUrl: 'http://localhost:3001/api/v1/ingest',
  batchSize: 50,
  flushIntervalMs: 2000,
  maxQueue: 10000,
  timeoutMs: 5000,
};

/** Hard per-request cap enforced by the platform (`POST /ingest` ≤ 500/req). */
export const MAX_EVENTS_PER_REQUEST = 500;

export class OncallClient {
  private readonly opts: Required<
    Omit<OncallClientOptions, 'fetchImpl' | 'onError'>
  > &
    Pick<OncallClientOptions, 'fetchImpl' | 'onError'>;
  private readonly queue: OncallWireEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  /** Tracks in-flight flushes so `close()`/`flush()` can await them. */
  private inflight = new Set<Promise<void>>();

  constructor(options: OncallClientOptions) {
    this.opts = {
      apiKey: options.apiKey,
      service: options.service,
      ingestUrl: options.ingestUrl ?? DEFAULTS.ingestUrl,
      batchSize: Math.max(1, options.batchSize ?? DEFAULTS.batchSize),
      flushIntervalMs: options.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
      maxQueue: Math.max(1, options.maxQueue ?? DEFAULTS.maxQueue),
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      fetchImpl: options.fetchImpl,
      onError: options.onError,
    };
    this.startTimer();
  }

  /**
   * Enqueue an event. Synchronous, non-blocking, and never throws (NFR-04).
   * Missing `service`/`timestamp` are filled from the client config / now.
   */
  capture(event: OncallEventInput): void {
    if (this.closed) return;
    try {
      const wire: OncallWireEvent = {
        timestamp: event.timestamp ?? Date.now(),
        service: event.service ?? this.opts.service,
        level: event.level,
        message: event.message,
        stack: event.stack ?? null,
        endpoint: event.endpoint ?? null,
        method: event.method ?? null,
        status: event.status ?? null,
        latency_ms: event.latency_ms ?? null,
      };
      this.queue.push(wire);
      // Bound memory: drop oldest beyond the cap (fail-silent back-pressure).
      while (this.queue.length > this.opts.maxQueue) this.queue.shift();
      if (this.queue.length >= this.opts.batchSize) {
        // Fire-and-forget; flush() is itself fail-silent.
        void this.flush();
      }
    } catch (err) {
      this.reportError(err);
    }
  }

  /** Convenience: capture with an explicit level + free-form fields. */
  log(level: LogLevel, message: string, fields: Partial<OncallEventInput> = {}): void {
    this.capture({ ...fields, level, message });
  }

  info(message: string, fields?: Partial<OncallEventInput>): void {
    this.log('info', message, fields);
  }
  warn(message: string, fields?: Partial<OncallEventInput>): void {
    this.log('warn', message, fields);
  }
  error(message: string, fields?: Partial<OncallEventInput>): void {
    this.log('error', message, fields);
  }

  /** Number of events currently buffered (pre-send). */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Flush all queued events (one or more batched POSTs). Never throws and never
   * rejects — transport failures are swallowed (surfaced via `onError`).
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batches: OncallWireEvent[][] = [];
    while (this.queue.length > 0) {
      batches.push(this.queue.splice(0, MAX_EVENTS_PER_REQUEST));
    }
    for (const batch of batches) {
      const p = this.send(batch);
      this.inflight.add(p);
      void p.finally(() => this.inflight.delete(p));
      // Await sequentially so ordering is preserved and back-pressure is real.
      await p;
    }
  }

  /** Stop the timer and flush any remaining events. Idempotent; never throws. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    await Promise.allSettled([...this.inflight]);
  }

  private startTimer(): void {
    if (this.opts.flushIntervalMs <= 0) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.opts.flushIntervalMs);
    // Do not keep the host process alive on the observability timer.
    this.timer.unref?.();
  }

  private async send(batch: OncallWireEvent[]): Promise<void> {
    const doFetch = this.opts.fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== 'function') {
      this.reportError(new Error('no fetch implementation available'));
      return;
    }
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    to.unref?.();
    try {
      const res = await doFetch(this.opts.ingestUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ingest-key': this.opts.apiKey,
        },
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
      });
      // A non-2xx is a delivery failure, but still must not throw (fail-silent).
      if (res && typeof res.ok === 'boolean' && !res.ok) {
        this.reportError(new Error(`ingest responded ${res.status}`));
      }
    } catch (err) {
      // Network error, abort/timeout, JSON error — all swallowed (NFR-04).
      this.reportError(err);
    } finally {
      clearTimeout(to);
    }
  }

  private reportError(err: unknown): void {
    try {
      this.opts.onError?.(err);
    } catch {
      // An onError that itself throws must never surface.
    }
  }
}

/** Factory mirroring the integration snippet ergonomics (SPEC §7.6). */
export function createClient(options: OncallClientOptions): OncallClient {
  return new OncallClient(options);
}
