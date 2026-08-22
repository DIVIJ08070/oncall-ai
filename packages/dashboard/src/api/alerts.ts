import type { AlertsResponse, AckAlertResponse } from '@oncall/shared';
import { apiFetch } from './client';

/**
 * Escalation + recovery clients (AI Incident PREVENTION — "ESCALATE IF IGNORED").
 *
 * `GET /api/v1/alerts` returns every active (and recently-resolved) early-warning
 * alert, each with its ordered escalation timeline (Dashboard → Email → CRITICAL →
 * RECOVERY). The EscalationTimeline polls it every 5s.
 *
 * `POST /api/v1/alerts/:id/ack` acknowledges an alert, which stops it climbing the
 * ladder any further. Idempotent — re-acking keeps the original acknowledgement.
 */
export function getAlerts(signal?: AbortSignal): Promise<AlertsResponse> {
  return apiFetch<AlertsResponse>('/alerts', { signal });
}

export function ackAlert(
  id: string,
  signal?: AbortSignal,
): Promise<AckAlertResponse> {
  return apiFetch<AckAlertResponse>(
    `/alerts/${encodeURIComponent(id)}/ack`,
    { method: 'POST', signal },
  );
}
