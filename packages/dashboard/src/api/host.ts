import type { HostEarlyWarningResponse } from '@oncall/shared';
import { apiFetch } from './client';

/**
 * `GET /api/v1/host-early-warning` (AI Incident PREVENTION — HOST layer). One row
 * per tracked (service, metric) with its live reading, bar fill, durable risk
 * status, breach probability + ETA, the human likely-cause + recommended action,
 * and a short sparkline series. Polled every 5s by the HostEarlyWarningCard, which
 * leads the dashboard with the most at-risk host resource (CPU / Memory / DB-pool).
 */
export function getHostEarlyWarning(
  signal?: AbortSignal,
): Promise<HostEarlyWarningResponse> {
  return apiFetch<HostEarlyWarningResponse>('/host-early-warning', { signal });
}
