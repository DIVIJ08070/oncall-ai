import type { FastifyInstance } from 'fastify';
import type {
  Alert,
  AlertSource,
  AlertStep,
  AlertTimeline,
  EscalationChannel,
  EscalationStatus,
  EscalationStep,
  EscalationStepKind,
  RiskStatus,
} from '@oncall/shared';
import type { AppContext } from '../app.js';
import type { AlertNotificationRow, AlertRow } from '../db/rows.js';
import { errorBody } from '../http/errors.js';

/**
 * Alerts read/ack surface (AI Incident PREVENTION — ESCALATE IF IGNORED).
 *
 *   GET  /api/v1/alerts            → active (+ recently-resolved) alerts, each
 *                                    with its ordered escalation timeline + ack
 *                                    state, most-at-risk first.
 *   POST /api/v1/alerts/:id/ack    → acknowledge an alert (stops further
 *                                    escalation); returns the updated alert.
 *
 * Open like the other prevention read routes — alerts carry no customer
 * dimension. The timeline is the alert's `alert_notifications` rows in order.
 */

/** How long a resolved alert stays listed so the UI can show its RECOVERY notice. */
const RESOLVED_DISPLAY_MS = 10 * 60 * 1000;

const STATUS_RANK: Record<RiskStatus, number> = {
  NORMAL: 0,
  RECOVERED: 0,
  EARLY_RISK: 1,
  WARNING: 2,
  ESCALATED: 3,
  BREACHED: 4,
};

function toAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    source: row.source as AlertSource,
    service: row.service,
    metric: row.metric,
    title: row.title,
    status: row.status as RiskStatus,
    step: (row.step as AlertStep | null) ?? null,
    current: row.current_value,
    threshold: row.threshold,
    probability: row.probability,
    minutesToBreach: row.minutes_to_breach,
    likelyCause: row.likely_cause,
    recommendedAction: row.recommended_action,
    acknowledged: row.acknowledged !== 0,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    firstDetectedAt: row.first_detected_at,
    lastEscalatedAt: row.last_escalated_at,
    resolvedAt: row.resolved_at,
    active: row.resolved_at == null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTimelineEntry(row: AlertNotificationRow): EscalationStep {
  return {
    id: row.id,
    step: row.step as EscalationStepKind,
    channel: row.channel as EscalationChannel,
    status: row.status as EscalationStatus,
    message: row.message,
    at: row.created_at,
  };
}

function toAlertTimeline(
  row: AlertRow,
  notifications: readonly AlertNotificationRow[],
): AlertTimeline {
  return {
    ...toAlert(row),
    timeline: notifications.map(toTimelineEntry),
  };
}

export function registerAlertsRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  const { db } = ctx;

  app.get('/api/v1/alerts', async (_req, reply) => {
    const now = Date.now();
    const rows = await db.dao.alerts.listActive(now - RESOLVED_DISPLAY_MS);

    const ids = rows.map((r) => r.id);
    const notifications = await db.dao.alertNotifications.listByAlerts(ids);
    const byAlert = new Map<string, AlertNotificationRow[]>();
    for (const n of notifications) {
      const list = byAlert.get(n.alert_id);
      if (list) list.push(n);
      else byAlert.set(n.alert_id, [n]);
    }

    const alerts: AlertTimeline[] = rows.map((r) =>
      toAlertTimeline(r, byAlert.get(r.id) ?? []),
    );

    // Most at-risk first: active before resolved, then by durable status rank,
    // then most-recently updated.
    alerts.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const rank =
        (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0);
      if (rank !== 0) return rank;
      return b.updatedAt - a.updatedAt;
    });

    return reply.code(200).send({ alerts, generatedAt: now });
  });

  app.post<{ Params: { id: string }; Body: { by?: string } }>(
    '/api/v1/alerts/:id/ack',
    async (req, reply) => {
      const { id } = req.params;
      const existing = await db.dao.alerts.getById(id);
      if (!existing) {
        return reply
          .code(404)
          .send(errorBody('not_found', `Alert ${id} not found`));
      }

      const now = Date.now();
      const by =
        typeof req.body?.by === 'string' && req.body.by.trim().length > 0
          ? req.body.by.trim()
          : 'dashboard';

      // Idempotent: re-acking keeps the original acknowledged_at/by.
      const updated = existing.acknowledged
        ? existing
        : (await db.dao.alerts.update(id, {
            acknowledged: true,
            acknowledged_at: now,
            acknowledged_by: by,
            updated_at: now,
          })) ?? existing;

      const notifications = await db.dao.alertNotifications.listByAlert(id);
      return reply
        .code(200)
        .send({ alert: toAlertTimeline(updated, notifications) });
    },
  );
}
