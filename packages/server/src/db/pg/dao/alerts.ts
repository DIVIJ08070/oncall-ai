import type pg from 'pg';
import { newAlertId } from '../../ids.js';
import type { AlertRow } from '../../rows.js';
import type {
  AlertPatch,
  AlertsDao,
  CreateAlertInput,
} from '../../dao/types.js';

/**
 * `alerts` DAO, postgres driver (AI Incident PREVENTION — ESCALATE IF IGNORED).
 * One durable early-warning alert per risky (service, metric/endpoint), keyed by
 * the `risk_states` surrogate key `(risk_service, risk_endpoint)`. `acknowledged`
 * persists as a 0/1 integer (SQLite-parity boolean). `id` is a prefixed ULID.
 */

const COLS =
  'id, source, service, metric, risk_service, risk_endpoint, title, status, step, ' +
  'current_value, threshold, probability, minutes_to_breach, likely_cause, ' +
  'recommended_action, acknowledged, acknowledged_at, acknowledged_by, ' +
  'first_detected_at, last_escalated_at, warning_at, resolved_at, ' +
  'created_at, updated_at';

export class PgAlertsDao implements AlertsDao {
  constructor(private readonly pool: pg.Pool) {}

  async getById(id: string): Promise<AlertRow | null> {
    const res = await this.pool.query<AlertRow>(
      `SELECT ${COLS} FROM alerts WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async getByRiskKey(
    riskService: string,
    riskEndpoint: string,
  ): Promise<AlertRow | null> {
    const res = await this.pool.query<AlertRow>(
      `SELECT ${COLS} FROM alerts WHERE risk_service = $1 AND risk_endpoint = $2`,
      [riskService, riskEndpoint],
    );
    return res.rows[0] ?? null;
  }

  async create(input: CreateAlertInput): Promise<AlertRow> {
    const now = input.created_at ?? Date.now();
    const res = await this.pool.query<AlertRow>(
      `INSERT INTO alerts
         (id, source, service, metric, risk_service, risk_endpoint, title, status,
          step, current_value, threshold, probability, minutes_to_breach,
          likely_cause, recommended_action, acknowledged, acknowledged_at,
          acknowledged_by, first_detected_at, last_escalated_at, warning_at,
          resolved_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23,$24)
       RETURNING ${COLS}`,
      [
        input.id ?? newAlertId(),
        input.source,
        input.service,
        input.metric,
        input.risk_service,
        input.risk_endpoint,
        input.title,
        input.status,
        input.step ?? null,
        input.current_value ?? null,
        input.threshold ?? null,
        input.probability ?? null,
        input.minutes_to_breach ?? null,
        input.likely_cause ?? null,
        input.recommended_action ?? null,
        input.acknowledged ? 1 : 0,
        input.acknowledged_at ?? null,
        input.acknowledged_by ?? null,
        input.first_detected_at,
        input.last_escalated_at ?? null,
        input.warning_at ?? null,
        input.resolved_at ?? null,
        now,
        input.updated_at ?? now,
      ],
    );
    return res.rows[0]!;
  }

  async update(id: string, patch: AlertPatch): Promise<AlertRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (patch.status !== undefined) set('status', patch.status);
    if (patch.step !== undefined) set('step', patch.step);
    if (patch.current_value !== undefined)
      set('current_value', patch.current_value);
    if (patch.threshold !== undefined) set('threshold', patch.threshold);
    if (patch.probability !== undefined) set('probability', patch.probability);
    if (patch.minutes_to_breach !== undefined)
      set('minutes_to_breach', patch.minutes_to_breach);
    if (patch.likely_cause !== undefined) set('likely_cause', patch.likely_cause);
    if (patch.recommended_action !== undefined)
      set('recommended_action', patch.recommended_action);
    if (patch.acknowledged !== undefined)
      set('acknowledged', patch.acknowledged ? 1 : 0);
    if (patch.acknowledged_at !== undefined)
      set('acknowledged_at', patch.acknowledged_at);
    if (patch.acknowledged_by !== undefined)
      set('acknowledged_by', patch.acknowledged_by);
    if (patch.first_detected_at !== undefined)
      set('first_detected_at', patch.first_detected_at);
    if (patch.last_escalated_at !== undefined)
      set('last_escalated_at', patch.last_escalated_at);
    if (patch.warning_at !== undefined) set('warning_at', patch.warning_at);
    if (patch.resolved_at !== undefined) set('resolved_at', patch.resolved_at);

    // Always bump updated_at.
    set('updated_at', patch.updated_at ?? Date.now());

    params.push(id);
    const res = await this.pool.query<AlertRow>(
      `UPDATE alerts SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING ${COLS}`,
      params,
    );
    return res.rows[0] ?? null;
  }

  async listActive(resolvedSinceMs = 0): Promise<AlertRow[]> {
    const res = await this.pool.query<AlertRow>(
      `SELECT ${COLS} FROM alerts
        WHERE resolved_at IS NULL OR resolved_at >= $1
        ORDER BY updated_at DESC, id DESC`,
      [resolvedSinceMs],
    );
    return res.rows;
  }
}
