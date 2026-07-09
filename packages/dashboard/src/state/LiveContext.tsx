import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ConnStatus } from '../sse/useEventStream';

/**
 * Global live-connection registry (DESIGN_SPEC §4): the TopBar shows "LIVE" when
 * any SSE surface is open. Each SSE surface reports its status by id; the provider
 * derives the aggregate. Future feeds (C13 InvestigationFeed/Chat) report here too.
 */

interface LiveRegistry {
  report: (id: string, status: ConnStatus) => void;
  clear: (id: string) => void;
  aggregate: ConnStatus;
}

const LiveContext = createContext<LiveRegistry | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, ConnStatus>>({});

  const report = useCallback((id: string, status: ConnStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }));
  }, []);

  const clear = useCallback((id: string) => {
    setStatuses((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const aggregate = useMemo<ConnStatus>(() => {
    const values = Object.values(statuses);
    if (values.some((s) => s === 'live')) return 'live';
    if (values.some((s) => s === 'reconnecting' || s === 'connecting'))
      return 'reconnecting';
    return 'closed';
  }, [statuses]);

  const value = useMemo(
    () => ({ report, clear, aggregate }),
    [report, clear, aggregate],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveAggregate(): ConnStatus {
  return useContext(LiveContext)?.aggregate ?? 'closed';
}

/** Report an SSE surface's status into the global registry (auto-clears on unmount). */
export function useReportLive(id: string, status: ConnStatus): void {
  const ctx = useContext(LiveContext);
  useEffect(() => {
    ctx?.report(id, status);
  }, [ctx, id, status]);
  useEffect(() => {
    return () => ctx?.clear(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}
