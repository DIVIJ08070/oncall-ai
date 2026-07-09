import type { FailureMode, VictimStateResponse } from '@oncall/shared';
import { apiFetch } from '../../api/client';

/**
 * Demo-control API layer (DESIGN_SPEC §6.4/§8.8, SPEC §7.7) — kept inside the C15
 * `demo/` directory so it never collides with C13/C14's edits to `api/index.ts`.
 * All calls hit the platform under `/api/v1/demo/*` (same-origin via the Vite proxy),
 * which bridges to the CORS-less victim app server-side.
 */

/** Both `POST /demo/failure-mode` and `GET /demo/state` return `{ mode, deployed_sha }`. */
export type DemoState = VictimStateResponse;

export interface TrafficResult {
  sent: number;
  ok: number;
  failed: number;
  target: string;
}

/** `GET /api/v1/demo/state` — the victim's current mode + deployed SHA. */
export function getDemoState(signal?: AbortSignal): Promise<DemoState> {
  return apiFetch<DemoState>('/demo/state', { signal });
}

/** `POST /api/v1/demo/failure-mode` — flip the victim + record the deploy row. */
export function setFailureMode(
  mode: FailureMode,
  signal?: AbortSignal,
): Promise<DemoState> {
  return apiFetch<DemoState>('/demo/failure-mode', {
    method: 'POST',
    body: { mode },
    signal,
  });
}

/** `POST /api/v1/demo/traffic` — fire a server-side burst at the victim. */
export function sendTraffic(
  params: { count: number; target: string },
  signal?: AbortSignal,
): Promise<TrafficResult> {
  return apiFetch<TrafficResult>('/demo/traffic', {
    method: 'POST',
    body: params,
    signal,
  });
}
