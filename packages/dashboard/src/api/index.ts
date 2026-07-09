import type {
  ServicesResponse,
  MetricsResponse,
  LogsResponse,
  IncidentsListResponse,
  LogLevel,
  User,
} from '@oncall/shared';
import { apiFetch, ApiRequestError } from './client';

/**
 * Per-resource typed clients (SPEC §7). Each returns the DTO imported from
 * `@oncall/shared` — the single contract source. C13/C14/C15 extend this module
 * with incident-detail, chat, repos, and demo-control calls.
 */

/** `GET /api/v1/services` (SPEC §7.2) — ServiceHealth strip, polled every 5s. */
export function getServices(signal?: AbortSignal): Promise<ServicesResponse> {
  return apiFetch<ServicesResponse>('/services', { signal });
}

/** `GET /api/v1/metrics` (SPEC §7.2) — current + baseline + series for a service. */
export function getMetrics(
  params: { service: string; window_sec?: number; resolution_sec?: number },
  signal?: AbortSignal,
): Promise<MetricsResponse> {
  return apiFetch<MetricsResponse>('/metrics', {
    query: {
      service: params.service,
      window_sec: params.window_sec,
      resolution_sec: params.resolution_sec,
    },
    signal,
  });
}

/** `GET /api/v1/logs` (SPEC §7.2b) — keyset-paginated history (newest-first). */
export function getLogs(
  params: {
    service?: string;
    level?: LogLevel;
    since?: number;
    until?: number;
    limit?: number;
  } = {},
  signal?: AbortSignal,
): Promise<LogsResponse> {
  return apiFetch<LogsResponse>('/logs', { query: { ...params }, signal });
}

/** `GET /api/v1/incidents` (SPEC §7.3) — incident summaries for the list view. */
export function getIncidents(
  params: { status?: string; service?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<IncidentsListResponse> {
  return apiFetch<IncidentsListResponse>('/incidents', {
    query: { ...params },
    signal,
  });
}

/**
 * `GET /api/v1/auth/me` (SPEC §7.5) — the signed-in user, or `null` when not
 * authenticated (401). Read APIs stay open under `DEV_NO_AUTH`, so a `null` here
 * means "dev/unauthenticated" for the shell's DEV badge + Sign-in affordance.
 */
export async function getAuthMe(signal?: AbortSignal): Promise<User | null> {
  try {
    const res = await apiFetch<{ user: User }>('/auth/me', { signal });
    return res.user;
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) return null;
    throw err;
  }
}
