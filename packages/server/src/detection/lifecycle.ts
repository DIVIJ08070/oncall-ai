import type { Incident, IncidentStatus } from '@oncall/shared';
import type { IncidentsDao } from '../db/dao/incidents.js';

/**
 * Incident lifecycle state machine helpers (SPEC §10.4). Small, reusable wrappers
 * over `IncidentsDao.update` so the detection engine (C5), the agent loop (C7),
 * and the recovery verifier (C9) drive the same transitions.
 *
 * ```
 * open ─(auto)→ investigating ─┬─ propose_fix → fix_proposed → awaiting_merge
 *                              │                                    │ (merge)
 *                              │                                    ▼
 *                              └─ escalate → escalated          verifying ─┬─ recovered → resolved
 *                                                                          └─ not_recovered → escalated
 * transient auto-heal: metrics recover before a PR merges → resolved (self-recovered)
 * ```
 */

/** Statuses eligible for transient auto-heal (pre-PR, human/verify-owned states excluded). */
export const AUTO_HEAL_STATUSES: readonly IncidentStatus[] = [
  'open',
  'investigating',
];

export function isAutoHealable(status: IncidentStatus): boolean {
  return AUTO_HEAL_STATUSES.includes(status);
}

/** `open → investigating` when the investigation session starts (SPEC §10.4). C7 calls this. */
export function markInvestigating(
  dao: IncidentsDao,
  id: string,
): Incident | null {
  return dao.update(id, { status: 'investigating' });
}

/** Enter the recovery window on merge detection (SPEC §10.5). C9 calls this. */
export function beginVerifying(dao: IncidentsDao, id: string): Incident | null {
  return dao.update(id, { status: 'verifying' });
}

/** `→ resolved` with a resolution timestamp (auto-heal or verified recovery). */
export function resolveIncident(
  dao: IncidentsDao,
  id: string,
  now: number,
): Incident | null {
  return dao.update(id, { status: 'resolved', resolved_at: now });
}

/** `→ escalated` (low confidence, verify failure, or overflow — SPEC §10.4). */
export function escalateIncident(
  dao: IncidentsDao,
  id: string,
): Incident | null {
  return dao.update(id, { status: 'escalated' });
}
