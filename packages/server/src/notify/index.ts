import type { Incident } from '@oncall/shared';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';
import type { NotificationStatus } from '../db/rows.js';
import type { Notifier } from '../detection/seams.js';
import { sendAlertEmail, emailConfigured } from './email.js';

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

  const record = async (
    incident: Incident,
    status: NotificationStatus,
    payload: unknown,
  ): Promise<void> => {
    try {
      await db.dao.notifications.insert({
        incident_id: incident.id,
        channel: 'slack',
        status,
        payload,
      });
    } catch (err) {
      log('[notify] failed to record notification', err);
    }
  };

  const emailFor = async (incident: Incident, kind: string): Promise<void> => {
    if (!emailConfigured(config)) return;
    const opened = kind !== 'incident_escalated';
    const subject = `${opened ? '🔴 Incident' : '⚠️ Escalation'} · ${incident.title}`;
    const body = [
      `${opened ? 'A new incident has been detected' : 'An incident has escalated'} on OnCall AI.`,
      '',
      `Service:   ${incident.service}`,
      `Title:     ${incident.title}`,
      `Severity:  ${incident.severity}`,
      `Detector:  ${incident.detector}`,
      `Observed:  ${incident.observed_value} (threshold ${incident.threshold_value})`,
      `Status:    ${incident.status}`,
      `Incident:  ${incident.id}`,
      '',
      'The AI is investigating and will open a fix PR if it finds a confident root cause.',
      `View incident: ${config.server.dashboardUrl.replace(/\/+$/, '')}/incidents/${incident.id}`,
    ].join('\n');
    try {
      const res = await sendAlertEmail(config, subject, body);
      await db.dao.notifications.insert({
        incident_id: incident.id,
        channel: 'email',
        status: res.ok ? 'sent' : res.simulated ? 'stubbed' : 'failed',
        payload: { subject, to: res.to, simulated: res.simulated, error: res.error },
      });
      if (res.ok) log(`[notify] email sent → ${res.to}`, { incident_id: incident.id });
      else if (res.error) log('[notify] email send failed', res.error);
    } catch (err) {
      log('[notify] email path threw', err);
    }
  };

  const fire = async (incident: Incident, kind: string): Promise<void> => {
    void emailFor(incident, kind);
    const payload = slackPayload(incident, kind);
    if (!webhook) {
      // Log-only stub (SPEC §14: empty webhook → log-only).
      log(`[notify] (stub) ${payload.text}`, { incident_id: incident.id });
      await record(incident, 'stubbed', { ...payload, webhook_configured: false });
      return;
    }
    try {
      const res = await doFetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await record(incident, res.ok ? 'sent' : 'failed', {
        ...payload,
        webhook_configured: true,
        http_status: res.status,
      });
    } catch (err) {
      log('[notify] webhook POST failed', err);
      await record(incident, 'failed', { ...payload, webhook_configured: true });
    }
  };

  return {
    incidentOpened: (incident) => fire(incident, 'incident_opened'),
    incidentEscalated: (incident) => fire(incident, 'incident_escalated'),
  };
}

/**
 * Send a "✅ resolved" email + record it. Called at every resolve site
 * (merge-poller recovery, detection self-heal). Best-effort; never throws.
 */
export async function emailIncidentResolved(
  db: OncallDb,
  config: Config,
  incident: Incident,
  log: NotifyLogger = () => {},
): Promise<void> {
  if (!emailConfigured(config)) return;
  const subject = `✅ Resolved · ${incident.title}`;
  const body = [
    `Good news — an incident on OnCall AI has recovered.`,
    '',
    `Service:  ${incident.service}`,
    `Title:    ${incident.title}`,
    `Status:   resolved`,
    `Incident: ${incident.id}`,
    '',
    'The service metrics are back within their healthy range.',
    `View incident: ${config.server.dashboardUrl.replace(/\/+$/, '')}/incidents/${incident.id}`,
  ].join('\n');
  try {
    const res = await sendAlertEmail(config, subject, body);
    await db.dao.notifications.insert({
      incident_id: incident.id,
      channel: 'email',
      status: res.ok ? 'sent' : res.simulated ? 'stubbed' : 'failed',
      payload: { subject, to: res.to, simulated: res.simulated, error: res.error },
    });
    if (res.ok) log(`[notify] resolved email sent → ${res.to}`, { incident_id: incident.id });
  } catch (err) {
    log('[notify] resolved email threw', err);
  }
}

/**
 * Send a "✅ Fix merged" email the moment the AI's fix PR is merged — before
 * recovery is verified — so the user gets a confirmation on merge regardless
 * of whether recovery later holds. Best-effort; never throws.
 */
export async function emailIncidentMerged(
  db: OncallDb,
  config: Config,
  incident: Incident,
  prNumber: number,
  log: NotifyLogger = () => {},
): Promise<void> {
  if (!emailConfigured(config)) return;
  const subject = `✅ Fix merged · ${incident.title}`;
  const link = `${config.server.dashboardUrl.replace(/\/+$/, '')}/incidents/${incident.id}`;
  const body = [
    `The AI fix PR #${prNumber} for this incident has been merged.`,
    '',
    `Service:  ${incident.service}`,
    `Title:    ${incident.title}`,
    `PR:       #${prNumber} (merged)`,
    `Incident: ${incident.id}`,
    '',
    'OnCall AI is now verifying that the service recovers; a follow-up',
    "'Resolved' email is sent once metrics return to healthy.",
    `View incident: ${link}`,
  ].join('\n');
  try {
    const res = await sendAlertEmail(config, subject, body);
    await db.dao.notifications.insert({
      incident_id: incident.id,
      channel: 'email',
      status: res.ok ? 'sent' : res.simulated ? 'stubbed' : 'failed',
      payload: { subject, to: res.to, simulated: res.simulated, error: res.error },
    });
    if (res.ok) log(`[notify] merged email sent -> ${res.to}`, { incident_id: incident.id });
  } catch (err) {
    log('[notify] merged email threw', err);
  }
}
