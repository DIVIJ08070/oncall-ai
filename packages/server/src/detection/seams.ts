import type { Incident } from '@oncall/shared';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';

/**
 * Injection seams the detection loop fires on the incident lifecycle (SPEC §10.4).
 * These are deliberately small interfaces so later chunks replace the defaults:
 *   - `Notifier` — the FR-17 Slack stub (real webhook POST lands in C10 `notify/`).
 *   - `InvestigationEnqueuer` — auto-start the AI investigation (FR-06); the real
 *     agent enqueue is C7. C5 ships a no-op default and a clean injection point.
 */

/** Optional structured logger (no-op by default). */
export type DetectionLogger = (message: string, meta?: unknown) => void;

/* ── Slack-stub notifier (FR-17) ─────────────────────────────────────────── */

export interface Notifier {
  /** Fired once when a *new* incident opens (never on dedup). */
  incidentOpened(incident: Incident): void | Promise<void>;
  /** Fired when an incident is (re-)escalated to a human. */
  incidentEscalated?(incident: Incident): void | Promise<void>;
}

/**
 * Default notifier: records a `stubbed` Slack `notifications` row (FR-17). The
 * actual webhook POST (when `SLACK_WEBHOOK_URL` is set) is C10's `notify/`
 * module; here we only persist the stub so the seam is observable and the
 * dashboard/postmortem can reference it.
 */
export function createSlackStubNotifier(db: OncallDb, config: Config): Notifier {
  const record = (incident: Incident, kind: string): void => {
    const payload = {
      kind,
      text: `:rotating_light: ${incident.title}`,
      incident_id: incident.id,
      service: incident.service,
      detector: incident.detector,
      severity: incident.severity,
      observed_value: incident.observed_value,
      threshold_value: incident.threshold_value,
      webhook_configured: Boolean(config.notify.slackWebhookUrl),
    };
    try {
      db.dao.notifications.insert({
        incident_id: incident.id,
        channel: 'slack',
        status: 'stubbed',
        payload,
      });
    } catch {
      // A notification failure must never break the detection tick.
    }
  };
  return {
    incidentOpened: (incident) => record(incident, 'incident_opened'),
    incidentEscalated: (incident) => record(incident, 'incident_escalated'),
  };
}

/* ── Investigation enqueuer (FR-06) ──────────────────────────────────────── */

export interface InvestigationEnqueuer {
  /** Auto-start the AI investigation for a freshly opened incident (FR-06). */
  enqueue(incident: Incident): void | Promise<void>;
}

/**
 * Default enqueuer: a no-op that logs the intent. C7 injects the real engine
 * runner (`LiveClaudeEngine`/`CachedEngine`) here, which will also transition the
 * incident `open → investigating` when the session starts (see
 * `lifecycle.ts#markInvestigating`).
 */
export function createNoopEnqueuer(log?: DetectionLogger): InvestigationEnqueuer {
  return {
    enqueue(incident) {
      log?.(`[detection] investigation enqueue seam (C7): ${incident.id}`, {
        service: incident.service,
        detector: incident.detector,
      });
    },
  };
}

/* ── Broker topics ───────────────────────────────────────────────────────── */

/** SSE/broker topic for a customer's incident lifecycle events (used by C10). */
export function incidentsTopic(customerId: string): string {
  return `incidents/${customerId}`;
}
