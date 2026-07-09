import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingState<T> {
  data: T | null;
  error: Error | null;
  /** True only on the very first load (drives skeletons, not refresh flicker). */
  loading: boolean;
  /** Epoch-ms of the last successful fetch (drives "last updated"). */
  updatedAt: number | null;
  refetch: () => void;
}

export interface PollingOptions {
  /** Poll cadence in ms. `0`/undefined → fetch once, no interval. */
  intervalMs?: number;
  /** When false, no fetching happens (e.g. paused/hidden surfaces). */
  enabled?: boolean;
}

/**
 * Fetch-on-mount + interval refresh with abort safety (SPEC §6 thin fetch layer).
 * Keeps the previous `data` visible across refreshes so polling never flashes a
 * skeleton — `loading` is true only until the first result resolves.
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList,
  { intervalMs = 0, enabled = true }: PollingOptions = {},
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  // Keep the latest fetcher without re-subscribing the interval each render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const controller = new AbortController();

    const run = async (): Promise<void> => {
      try {
        const result = await fetcherRef.current(controller.signal);
        if (cancelled) return;
        setData(result);
        setError(null);
        setUpdatedAt(Date.now());
        setLoading(false);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError'))
          return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    };

    void run();
    const id =
      intervalMs > 0 ? window.setInterval(() => void run(), intervalMs) : undefined;

    return () => {
      cancelled = true;
      controller.abort();
      if (id !== undefined) window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs, enabled, nonce]);

  return { data, error, loading, updatedAt, refetch };
}
