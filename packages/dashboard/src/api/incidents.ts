import type {
  IncidentDetailResponse,
  ChatResponse,
  InvestigateResponse,
  PostmortemResponse,
} from '@oncall/shared';
import { apiFetch, ApiRequestError } from './client';

/**
 * Incident-detail + chat + postmortem clients (SPEC §7.3/§7.4) — the C13 surface.
 * Kept in its own module (not the shared `api/index.ts`) so C13/C14/C15 extend the
 * api layer without colliding on one file. DTOs import from `@oncall/shared`.
 */

/** `GET /api/v1/incidents/:id` (SPEC §7.3) — full detail: incident + session + steps + PR + timeline. */
export function getIncident(
  id: string,
  signal?: AbortSignal,
): Promise<IncidentDetailResponse> {
  return apiFetch<IncidentDetailResponse>(`/incidents/${encodeURIComponent(id)}`, {
    signal,
  });
}

/**
 * `POST /api/v1/incidents/:id/investigate` (SPEC §7.3) — manual (re)trigger of the
 * investigation. Normally automatic on open; exposed in dev so the feed's empty
 * state can kick a run.
 */
export function investigateIncident(
  id: string,
  signal?: AbortSignal,
): Promise<InvestigateResponse> {
  return apiFetch<InvestigateResponse>(
    `/incidents/${encodeURIComponent(id)}/investigate`,
    { method: 'POST', signal },
  );
}

/** `POST /api/v1/incidents/:id/chat` (SPEC §7.4, FR-16) — a bounded read-only agent turn. */
export function postChat(
  id: string,
  message: string,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  return apiFetch<ChatResponse>(`/incidents/${encodeURIComponent(id)}/chat`, {
    method: 'POST',
    body: { message },
    signal,
  });
}

/**
 * `GET /api/v1/incidents/:id/postmortem` (SPEC §7.4, FR-18) — the stored draft, or
 * `null` when none exists yet (404).
 */
export async function getPostmortem(
  id: string,
  signal?: AbortSignal,
): Promise<PostmortemResponse | null> {
  try {
    return await apiFetch<PostmortemResponse>(
      `/incidents/${encodeURIComponent(id)}/postmortem`,
      { signal },
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return null;
    throw err;
  }
}

/** `POST /api/v1/incidents/:id/postmortem` (SPEC §7.4, FR-18) — generate + store a draft. */
export function generatePostmortem(
  id: string,
  signal?: AbortSignal,
): Promise<PostmortemResponse> {
  return apiFetch<PostmortemResponse>(
    `/incidents/${encodeURIComponent(id)}/postmortem`,
    { method: 'POST', signal },
  );
}
