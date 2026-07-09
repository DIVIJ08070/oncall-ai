import type { Incident } from '@oncall/shared';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';
import type { NotificationStatus } from '../db/rows.js';
import type { Notifier } from '../detection/seams.js';

/**
 * Slack notification stub (SPEC §7 side-effect, FR-17). Implements the detection
 * `Notifier` seam. When `SLACK_WEBHOOK_URL` is set it POSTs a Slack-style payload;
 * otherwise it is log-only. Either way it records a `notifications` row (`sent` /
 * `stubbed` / `failed`) so the dashboard + postmortem can reference the alert.
 *
 * A notification must never break a detection tick — every path swallows errors.
 */

export type NotifyLogger = (message: string, meta?: unknown) => void;

/** Optional injected fetch (tests); defaults to the global `fetch`. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

export interface SlackNotifierDeps {
  db: OncallDb;
  config: Config;
  fetchImpl?: FetchLike;
  logger?: NotifyLogger;
}

function slackPayload(incident: Incident, kind: string): Record<string, unknown> {
  const emoji = kind === 'incident_escalated' ? ':warning:' : ':rotating_light:';
  return {
    kind,
    text: `${emoji} ${incident.title}`,
    incident_id: incident.id,
    service: incident.service,
    detector: incident.detector,
    severity: incident.severity,
    status: incident.status,
    observed_value: incident.observed_value,
    threshold_value: incident.threshold_value,
  };
}

export function createSlackNotifier(deps: SlackNotifierDeps): Notifier {
  const { db, config } = deps;
  const log = deps.logger ?? (() => {});
  const webhook = config.notify.slackWebhookUrl;
  const doFetch: FetchLike =
    deps.fetchImpl ??
    ((url, init) => fetch(url, init).then((r) => ({ ok: r.ok, status: r.status })));

  const record = (incident: Incident, status: NotificationStatus, payload: unknown): void => {
    try {
      db.dao.notifications.insert({
        incident_id: incident.id,
        channel: 'slack',
        status,
        payload,
      });
    } catch (err) {
      log('[notify] failed to record notification', err);
    }
  };

  const fire = async (incident: Incident, kind: string): Promise<void> => {
    const payload = slackPayload(incident, kind);
    if (!webhook) {
      // Log-only stub (SPEC §14: empty webhook → log-only).
      log(`[notify] (stub) ${payload.text}`, { incident_id: incident.id });
      record(incident, 'stubbed', { ...payload, webhook_configured: false });
      return;
    }
    try {
      const res = await doFetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      record(incident, res.ok ? 'sent' : 'failed', {
        ...payload,
        webhook_configured: true,
        http_status: res.status,
      });
    } catch (err) {
      log('[notify] webhook POST failed', err);
      record(incident, 'failed', { ...payload, webhook_configured: true });
    }
  };

  return {
    incidentOpened: (incident) => fire(incident, 'incident_opened'),
    incidentEscalated: (incident) => fire(incident, 'incident_escalated'),
  };
}
