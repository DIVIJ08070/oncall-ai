import { useEffect, useRef, useState } from 'react';

/**
 * EventSource hook with auto-reconnect + backoff (SPEC §6, DESIGN_SPEC §10/§11).
 *
 * Backs every SSE surface (LogStream now; InvestigationFeed/Chat in C13). Named
 * server events (`event: log`, `event: step`, …) map to the `events` handlers;
 * the `:heartbeat` comment keeps the socket warm (EventSource ignores comments).
 * `status` drives the shared `ConnectionStatus` pill.
 */

export type ConnStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface EventStreamOptions {
  /** Map of SSE event name → handler receiving the parsed `data` payload. */
  events: Record<string, (data: unknown) => void>;
  /** When false (or url null) the stream is not opened. */
  enabled?: boolean;
  /** Notified on every status transition (optional). */
  onStatusChange?: (status: ConnStatus) => void;
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1000;

export function useEventStream(
  url: string | null,
  opts: EventStreamOptions,
): { status: ConnStatus; retry: () => void } {
  const [status, setStatus] = useState<ConnStatus>('closed');

  // Keep handlers current without reconnecting on every render.
  const eventsRef = useRef(opts.events);
  eventsRef.current = opts.events;
  const onStatusRef = useRef(opts.onStatusChange);
  onStatusRef.current = opts.onStatusChange;

  // Manual reconnect trigger.
  const [nonce, setNonce] = useState(0);
  const retry = (): void => setNonce((n) => n + 1);

  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!url || !enabled) {
      setStatus('closed');
      return;
    }

    let source: EventSource | null = null;
    let retries = 0;
    let reconnectTimer: number | undefined;
    let disposed = false;

    const move = (next: ConnStatus): void => {
      setStatus(next);
      onStatusRef.current?.(next);
    };

    const attach = (es: EventSource): void => {
      for (const name of Object.keys(eventsRef.current)) {
        es.addEventListener(name, (ev: MessageEvent) => {
          let parsed: unknown = ev.data;
          try {
            parsed = JSON.parse(ev.data as string);
          } catch {
            /* leave as raw string if not JSON */
          }
          eventsRef.current[name]?.(parsed);
        });
      }
    };

    const connect = (): void => {
      if (disposed) return;
      move(retries === 0 ? 'connecting' : 'reconnecting');
      const es = new EventSource(url, { withCredentials: true });
      source = es;

      es.onopen = (): void => {
        retries = 0;
        move('live');
      };

      es.onerror = (): void => {
        // The socket dropped or failed to open. Close this instance and schedule
        // an explicit backoff reconnect (don't lean on the browser's implicit one
        // so `status` and cadence stay under our control).
        es.close();
        if (disposed) return;
        move('reconnecting');
        const delay = Math.min(
          MAX_BACKOFF_MS,
          BASE_BACKOFF_MS * 2 ** retries,
        );
        retries += 1;
        const jitter = Math.random() * 300;
        reconnectTimer = window.setTimeout(connect, delay + jitter);
      };

      attach(es);
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      source?.close();
      setStatus('closed');
    };
  }, [url, enabled, nonce]);

  return { status, retry };
}
