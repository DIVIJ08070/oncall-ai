import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@oncall/shared';
import { getAuthMe } from '../api';

/**
 * SessionContext (SPEC §6 — "No global store beyond a SessionContext: current
 * OAuth user + selected repo"). C12 seeds it from `GET /auth/me`; C14 (onboarding)
 * fills the selected-repo slot. A `null` user under open read APIs ⇒ dev mode.
 */

interface SessionState {
  user: User | null;
  /** True until the initial auth probe resolves. */
  loading: boolean;
  /** Best-effort DEV_NO_AUTH signal: unauthenticated while read APIs stay open. */
  devMode: boolean;
}

const SessionContext = createContext<SessionState>({
  user: null,
  loading: true,
  devMode: false,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    getAuthMe(controller.signal)
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const value = useMemo<SessionState>(
    () => ({ user, loading, devMode: !loading && user === null }),
    [user, loading],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
