import type { EndpointPerformance } from '@oncall/shared';
import { apiFetch } from './client';

/**
 * `GET /api/v1/performance` (AI Incident PREVENTION Phase 1). The latest rollup
 * window per (service, endpoint) with its 0-100 performance score breakdown and
 * breach prediction, worst score first — the source the dashboard's AI Early
 * Warning card polls to lead with the most at-risk endpoints.
 */
export interface PerformanceResponse {
  endpoints: EndpointPerformance[];
  /** Epoch-ms the platform assembled this snapshot. */
  generatedAt: number;
}

export function getPerformance(signal?: AbortSignal): Promise<PerformanceResponse> {
  return apiFetch<PerformanceResponse>('/performance', { signal });
}
