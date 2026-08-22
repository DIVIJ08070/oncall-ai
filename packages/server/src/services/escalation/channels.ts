import type {
  EscalationChannel,
  EscalationStatus,
  EscalationStepKind,
} from '@oncall/shared';
import type { Config } from '../../config.js';

/**
 * Escalation channel registry (AI Incident PREVENTION — ESCALATE IF IGNORED).
 *
 * Each channel is a tiny adapter `{ name, enabled, send(input, step) }`. Only
 * `dashboard` + `email` are ENABLED; `sms` + `whatsapp` are present-but-disabled
 * STUBS (TODO: wire real providers). Channels are SIMULATED — a send renders a
 * realistic message body + payload and returns `sent` (the engine persists it as
 * an `alert_notifications` row and streams an SSE). The email adapter reuses a
 * configured Slack webhook when present (best-effort), else it simulates an
 * email; either way the timeline records a `sent` email.
 *
 * To page on-call by SMS/WhatsApp later: flip `enabled: true` here AND add the
 * channel to the CRITICAL rung in the ladder config (policy.ts) — one line each.
 */

/** Everything a channel needs to render + deliver one escalation message. */
export interface ChannelSendInput {
  alertId: string;
  source: string;
  service: string;
  /** cpu | mem | db_pool, or the endpoint path for api alerts. */
  metric: string;
  status: string;
  current: number | null;
  threshold: number | null;
  probability: number | null;
  minutesToBreach: number | null;
  likelyCause: string | null;
  recommendedAction: string | null;
  /** How long the WARNING went unacknowledged (seconds) — set for CRITICAL. */
  ignoredForSec?: number | null;
  dashboardUrl: string;
  now: number;
}

/** The outcome of one channel send — persisted to the timeline. */
export interface ChannelSendResult {
  status: EscalationStatus;
  message: string;
  payload: unknown;
}

/** A delivery channel adapter. */
export interface ChannelAdapter {
  name: EscalationChannel;
  enabled: boolean;
  send(
    input: ChannelSendInput,
    step: EscalationStepKind,
  ): Promise<ChannelSendResult>;
}

/** Optional injected fetch (tests); defaults to the global `fetch`. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/* ── message rendering (shared by every channel) ─────────────────────────── */

const METRIC_LABELS: Record<string, string> = {
  cpu: 'CPU',
  mem: 'Memory',
  db_pool: 'DB connection pool',
};

/** Human label for a metric (host names get a friendly label; endpoints as-is). */
export function metricLabel(source: string, metric: string): string {
  if (source === 'host') return METRIC_LABELS[metric] ?? metric;
  return metric;
}

function unit(source: string): string {
  return source === 'host' ? '%' : 'ms';
}

function fmtNum(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return String(Math.round(n * 10) / 10);
}

function pct(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '—';
  return `${Math.round(p * 100)}%`;
}

function eta(m: number | null): string {
  return m == null ? 'no clear ETA' : `~${m} min`;
}

/** A compact one-line summary of the current reading + prediction. */
function readingLine(i: ChannelSendInput): string {
  const label = metricLabel(i.source, i.metric);
  const u = unit(i.source);
  return `${i.service} · ${label} at ${fmtNum(i.current)}${u} (threshold ${fmtNum(
    i.threshold,
  )}${u}) — breach probability ${pct(i.probability)}, ETA ${eta(
    i.minutesToBreach,
  )}.`;
}

/** The subject/headline for one ladder rung. */
export function renderSubject(
  step: EscalationStepKind,
  i: ChannelSendInput,
): string {
  const label = metricLabel(i.source, i.metric);
  const who = `${i.service} ${label}`;
  switch (step) {
    case 'EARLY_RISK':
      return `Early warning: ${who} trending toward its limit`;
    case 'WARNING':
      return `WARNING: ${who} may breach soon — action recommended`;
    case 'CRITICAL':
      return `CRITICAL: ${who} escalation unacknowledged — paging`;
    case 'RECOVERY':
      return `Resolved: ${who} back to normal`;
  }
}

/** The full message body for one ladder rung (rendered per channel). */
export function renderBody(step: EscalationStepKind, i: ChannelSendInput): string {
  const reading = readingLine(i);
  const cause = i.likelyCause ? `Likely cause: ${i.likelyCause}` : '';
  const action = i.recommendedAction
    ? `Recommended action: ${i.recommendedAction}`
    : '';
  switch (step) {
    case 'EARLY_RISK':
      return [
        `Early warning — ${reading}`,
        cause,
        'No action required yet; monitoring on the dashboard.',
      ]
        .filter(Boolean)
        .join(' ');
    case 'WARNING':
      return [`Warning — ${reading}`, cause, action].filter(Boolean).join(' ');
    case 'CRITICAL': {
      const ignored =
        i.ignoredForSec != null
          ? `No one acknowledged the warning within ${i.ignoredForSec}s.`
          : 'The warning went unacknowledged.';
      return [`CRITICAL — ${ignored}`, reading, action].filter(Boolean).join(' ');
    }
    case 'RECOVERY':
      return `Recovered — ${i.service} ${metricLabel(
        i.source,
        i.metric,
      )} has returned to normal (now ${fmtNum(i.current)}${unit(i.source)}).`;
  }
}

/* ── adapters ────────────────────────────────────────────────────────────── */

/** Dashboard channel — always enabled, no external I/O (banner on the console). */
function dashboardAdapter(): ChannelAdapter {
  return {
    name: 'dashboard',
    enabled: true,
    send: async (input, step) => {
      const message = renderSubject(step, input);
      return {
        status: 'sent',
        message,
        payload: {
          channel: 'dashboard',
          step,
          headline: message,
          body: renderBody(step, input),
          url: `${input.dashboardUrl}/dashboard`,
        },
      };
    },
  };
}

/**
 * Email channel — enabled + SIMULATED. Renders a realistic email (to/subject/
 * body). If a Slack webhook is configured, it also POSTs a short summary
 * best-effort (a `failed` POST never fails the send — the email is still
 * recorded `sent`). Swap in a real SMTP/provider call where marked.
 */
function emailAdapter(config: Config, fetchImpl?: FetchLike): ChannelAdapter {
  const webhook = config.notify.slackWebhookUrl;
  const doFetch: FetchLike =
    fetchImpl ??
    ((url, init) => fetch(url, init).then((r) => ({ ok: r.ok, status: r.status })));

  return {
    name: 'email',
    enabled: true,
    send: async (input, step) => {
      const subject = renderSubject(step, input);
      const body = renderBody(step, input);
      // Demo recipient — a real deployment reads this from an on-call roster.
      const to = 'oncall@example.com';
      const payload: Record<string, unknown> = {
        channel: 'email',
        step,
        to,
        subject,
        body,
        simulated: true,
      };

      // Best-effort webhook mirror (Slack-style) when configured. Never throws.
      if (webhook) {
        payload.simulated = false;
        payload.webhook_configured = true;
        try {
          const res = await doFetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: `:rotating_light: ${subject}\n${body}`,
              alert_id: input.alertId,
              step,
            }),
          });
          payload.http_status = res.status;
        } catch {
          payload.webhook_error = true;
        }
      }

      // Channels are simulated → the email is always recorded as sent.
      return { status: 'sent', message: `${subject} → ${to}`, payload };
    },
  };
}

/**
 * SMS stub — DISABLED. Present so the ladder can enable paging with one line.
 * TODO: wire a real SMS provider (Twilio et al.) and flip `enabled: true`.
 */
function smsStub(): ChannelAdapter {
  return {
    name: 'sms',
    enabled: false,
    send: async (input, step) => ({
      status: 'stubbed',
      message: `[SMS stub] ${renderSubject(step, input)}`,
      payload: {
        channel: 'sms',
        step,
        stub: true,
        todo: 'wire a real SMS provider',
      },
    }),
  };
}

/**
 * WhatsApp stub — DISABLED. Present so the ladder can enable paging with one line.
 * TODO: wire the WhatsApp Business API and flip `enabled: true`.
 */
function whatsappStub(): ChannelAdapter {
  return {
    name: 'whatsapp',
    enabled: false,
    send: async (input, step) => ({
      status: 'stubbed',
      message: `[WhatsApp stub] ${renderSubject(step, input)}`,
      payload: {
        channel: 'whatsapp',
        step,
        stub: true,
        todo: 'wire the WhatsApp Business API',
      },
    }),
  };
}

/** The registry of channel adapters, keyed by name. */
export interface ChannelRegistry {
  get(name: EscalationChannel): ChannelAdapter | undefined;
  isEnabled(name: EscalationChannel): boolean;
  list(): ChannelAdapter[];
}

/** Build the channel registry (dashboard + email enabled; sms/whatsapp stubs). */
export function createChannelRegistry(
  config: Config,
  fetchImpl?: FetchLike,
): ChannelRegistry {
  const adapters: ChannelAdapter[] = [
    dashboardAdapter(),
    emailAdapter(config, fetchImpl),
    smsStub(),
    whatsappStub(),
  ];
  const byName = new Map<EscalationChannel, ChannelAdapter>(
    adapters.map((a) => [a.name, a]),
  );
  return {
    get: (name) => byName.get(name),
    isEnabled: (name) => byName.get(name)?.enabled ?? false,
    list: () => [...adapters],
  };
}
