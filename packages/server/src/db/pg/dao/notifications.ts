import type pg from 'pg';
import { newNotificationId } from '../../ids.js';
import type {
  NotificationChannel,
  NotificationRow,
  NotificationStatus,
} from '../../rows.js';
import { fromJson, toJson } from '../../rows.js';
import type {
  CreateNotificationInput,
  NotificationsDao,
} from '../../dao/types.js';

/**
 * `notifications` DAO, postgres driver (FR-17 stub). `payload` persists as
 * JSON TEXT and is parsed back on read, exactly as under sqlite.
 */

interface NotificationDbRow {
  id: string;
  incident_id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  payload: string;
  created_at: number;
}

function decode(row: NotificationDbRow): NotificationRow {
  return {
    id: row.id,
    incident_id: row.incident_id,
    channel: row.channel,
    status: row.status,
    payload: fromJson<unknown>(row.payload),
    created_at: row.created_at,
  };
}

export class PgNotificationsDao implements NotificationsDao {
  constructor(private readonly pool: pg.Pool) {}

  async insert(input: CreateNotificationInput): Promise<NotificationRow> {
    const dbRow: NotificationDbRow = {
      id: input.id ?? newNotificationId(),
      incident_id: input.incident_id,
      channel: input.channel,
      status: input.status,
      // `payload` is NOT NULL in the schema — default to an empty object.
      payload: toJson(input.payload ?? {}) ?? '{}',
      created_at: input.created_at ?? Date.now(),
    };
    await this.pool.query(
      `INSERT INTO notifications (id, incident_id, channel, status, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        dbRow.id,
        dbRow.incident_id,
        dbRow.channel,
        dbRow.status,
        dbRow.payload,
        dbRow.created_at,
      ],
    );
    return decode(dbRow);
  }

  async listByIncident(incidentId: string): Promise<NotificationRow[]> {
    const res = await this.pool.query<NotificationDbRow>(
      `SELECT * FROM notifications WHERE incident_id = $1 ORDER BY created_at ASC`,
      [incidentId],
    );
    return res.rows.map(decode);
  }
}
