import type {
  Incident,
  IncidentDetailResponse,
  IncidentSummary,
  PullRequestRec,
  PullRequestSummary,
  Session,
  Step,
  TimelineEntry,
} from '@oncall/shared';
import { TERMINAL_STATUSES } from '../db/dao/incidents.js';
import type { OncallDb } from '../db/index.js';

/**
 * Incident read-model builders (SPEC §7.3). Assemble the list-summary and the
 * full detail DTO (`incident` + `session` + `steps` + `pull_request` + `timeline`)
 * from the persisted rows. Pure functions of `(db, …)` so the routes and tests
 * call them deterministically.
 */

/** Compact incident for `GET /incidents` (SPEC §7.3 `IncidentSummary`). */
export function toIncidentSummary(inc: Incident): IncidentSummary {
  return {
    id: inc.id,
    service: inc.service,
    detector: inc.detector,
    title: inc.title,
    status: inc.status,
    severity: inc.severity,
    observed_value: inc.observed_value,
    threshold_value: inc.threshold_value,
    confidence: inc.confidence,
    opened_at: inc.opened_at,
    resolved_at: inc.resolved_at,
    active: !TERMINAL_STATUSES.includes(inc.status),
  };
}

/** Compact PR shape embedded in incident detail (SPEC §7.3 `pull_request`). */
export function toPullRequestSummary(pr: PullRequestRec): PullRequestSummary {
  return {
    number: pr.github_pr_number,
    url: pr.url,
    kind: pr.kind,
    state: pr.state,
    verification_status: pr.verification_status,
  };
}

/**
 * Build the lifecycle timeline (SPEC §7.3 `timeline[]`). Kinds are exactly the
 * §7.3 enum (`detected|investigating|pr_opened|merged|verifying|resolved|escalated`).
 * Derived from the incident's timestamps + the session start + the PR events.
 */
export function buildTimeline(
  incident: Incident,
  session: Session | null,
  pr: PullRequestRec | null,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  entries.push({
    ts: incident.detected_at,
    kind: 'detected',
    label: `Detected ${incident.detector.replace('_', ' ')} on ${incident.service}`,
  });

  if (session) {
    entries.push({
      ts: session.started_at,
      kind: 'investigating',
      label: `Investigation started (${session.mode})`,
    });
  }

  if (pr) {
    entries.push({
      ts: pr.created_at,
      kind: 'pr_opened',
      label: `Opened ${pr.kind} PR #${pr.github_pr_number}`,
    });
    if (pr.merged_at !== null) {
      entries.push({
        ts: pr.merged_at,
        kind: 'merged',
        label: `PR #${pr.github_pr_number} merged`,
      });
    }
  }

  if (incident.status === 'verifying') {
    entries.push({
      ts: incident.updated_at,
      kind: 'verifying',
      label: 'Verifying recovery',
    });
  }

  if (incident.status === 'escalated') {
    entries.push({
      ts: incident.updated_at,
      kind: 'escalated',
      label: 'Escalated to a human',
    });
  }

  if (incident.resolved_at !== null) {
    entries.push({
      ts: incident.resolved_at,
      kind: 'resolved',
      label: 'Incident resolved',
    });
  }

  // Chronological (stable on ties by insertion order).
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.ts - b.e.ts || a.i - b.i)
    .map(({ e }) => e);
}

/**
 * Assemble the full `GET /incidents/:id` DTO (SPEC §7.3). Returns `null` when the
 * incident does not exist (or belongs to another customer) → the route 404s.
 */
export function buildIncidentDetail(
  db: OncallDb,
  incidentId: string,
  customerId?: string,
): IncidentDetailResponse | null {
  const incident = db.dao.incidents.getById(incidentId);
  if (!incident) return null;
  if (customerId !== undefined && incident.customer_id !== customerId) return null;

  const session = db.dao.sessions.latestForIncident(incidentId);
  const steps: Step[] = session ? db.dao.steps.listBySession(session.id) : [];
  const prRec = db.dao.pullRequests.getByIncident(incidentId);

  return {
    incident,
    session: session ?? null,
    steps,
    pull_request: prRec ? toPullRequestSummary(prRec) : null,
    timeline: buildTimeline(incident, session ?? null, prRec),
  };
}
