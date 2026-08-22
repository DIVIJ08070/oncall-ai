import type { WhatChangedResult, HypothesisChallengeResult } from '@oncall/shared';
import { apiFetch, ApiRequestError } from './client';

/**
 * AI Incident PREVENTION Phase 5 clients — "What Changed?" (deploy + metric
 * correlation) and "Ask Why" (challenge the current hypothesis). Both hang off an
 * incident, so they live beside the C13 incident-detail surface. DTOs come from
 * `@oncall/shared` — the single contract source.
 */

/**
 * `GET /api/v1/incidents/:id/what-changed` (Phase 5) — the prime-suspect deploy,
 * every candidate change ranked by correlation with the incident onset, and an
 * evidence-grounded explanation. Returns `null` on 404 so the panel can render a
 * calm empty state rather than throwing.
 */
export async function getWhatChanged(
  id: string,
  signal?: AbortSignal,
): Promise<WhatChangedResult | null> {
  try {
    return await apiFetch<WhatChangedResult>(
      `/incidents/${encodeURIComponent(id)}/what-changed`,
      { signal },
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return null;
    throw err;
  }
}

/**
 * `POST /api/v1/incidents/:id/challenge` (Phase 5, "Ask Why") — weigh a free-text
 * challenge against the evidence and return the revised hypothesis, confidence,
 * whether it changed, and the evidence the revision is grounded in.
 */
export function challengeHypothesis(
  id: string,
  message: string,
  signal?: AbortSignal,
): Promise<HypothesisChallengeResult> {
  return apiFetch<HypothesisChallengeResult>(
    `/incidents/${encodeURIComponent(id)}/challenge`,
    { method: 'POST', body: { message }, signal },
  );
}
