import type pg from 'pg';
import { newAlertNotificationId } from '../../ids.js';
import type { AlertNotificationRow } from '../../rows.js';
import { fromJson, toJson } from '../../rows.js';
import type {
  AlertNotificationsDao,
  CreateAlertNotificationInput,
} from '../../dao/types.js';

/**
 * `alert_notifications` DAO, postgres driver — the per-alert escalation timeline.
 * One row per channel send (and per RECOVERY send). `payload` persists as JSON
 * TEXT and is parsed back on read. Ordered by `(created_at, id)` so same-ms rows
 * return in insertion order.
 */

interface DbRow {
  id: string;
  alert_id: string;
  step: string;
  channel: string;
  status: string;
  message: string;
  payload: string;
  created_at: number;
}

function decode(row: DbRow): AlertNotificationRow {
  return {
    id: row.id,
    alert_id: row.alert_id,
    step: row.step,
    channel: row.channel,
    status: row.status,
    message: row.message,
    payload: fromJson<unknown>(row.payload),
    created_at: row.created_at,
  };
}

export class PgAlertNotificationsDao implements AlertNotificationsDao {
  constructor(private readonly pool: pg.Pool) {}

  async insert(
    input: CreateAlertNotificationInput,
  ): Promise<AlertNotificationRow> {
    const dbRow: DbRow = {
      id: input.id ?? newAlertNotificationId(),
      alert_id: input.alert_id,
      step: input.step,
      channel: input.channel,
      status: input.status,
      message: input.message,
      payload: toJson(input.payload ?? {}) ?? '{}',
      created_at: input.created_at ?? Date.now(),
    };
    await this.pool.query(
      `INSERT INTO alert_notifications
         (id, alert_id, step, channel, status, message, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        dbRow.id,
        dbRow.alert_id,
        dbRow.step,
        dbRow.channel,
        dbRow.status,
        dbRow.message,
        dbRow.payload,
        dbRow.created_at,
      ],
    );
    return decode(dbRow);
  }

  async listByAlert(alertId: string): Promise<AlertNotificationRow[]> {
    const res = await this.pool.query<DbRow>(
      `SELECT * FROM alert_notifications
        WHERE alert_id = $1
        ORDER BY created_at ASC, id ASC`,
      [alertId],
    );
    return res.rows.map(decode);
  }

  async listByAlerts(
    alertIds: readonly string[],
  ): Promise<AlertNotificationRow[]> {
    if (alertIds.length === 0) return [];
    const res = await this.pool.query<DbRow>(
      `SELECT * FROM alert_notifications
        WHERE alert_id = ANY($1::text[])
        ORDER BY created_at ASC, id ASC`,
      [alertIds as string[]],
    );
    return res.rows.map(decode);
  }
}
