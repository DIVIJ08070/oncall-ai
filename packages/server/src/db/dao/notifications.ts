import type BetterSqlite3 from 'better-sqlite3';
import { newNotificationId } from '../ids.js';
import type {
  NotificationChannel,
  NotificationRow,
  NotificationStatus,
} from '../rows.js';
import { fromJson, toJson } from '../rows.js';

/**
 * `notifications` DAO (SPEC §8, FR-17 stub). Records Slack notification
 * attempts; `payload` persists as JSON TEXT and is parsed back on read.
 */

export interface CreateNotificationInput {
  incident_id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  payload: unknown;
  created_at?: number;
  id?: string;
}

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

export class NotificationsDao {
  constructor(private readonly db: BetterSqlite3.Database) {}

  insert(input: CreateNotificationInput): NotificationRow {
    const dbRow: NotificationDbRow = {
      id: input.id ?? newNotificationId(),
      incident_id: input.incident_id,
      channel: input.channel,
      status: input.status,
      // `payload` is NOT NULL in the schema — default to an empty object.
      payload: toJson(input.payload ?? {}) ?? '{}',
      created_at: input.created_at ?? Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO notifications (id, incident_id, channel, status, payload, created_at)
         VALUES (@id, @incident_id, @channel, @status, @payload, @created_at)`,
      )
      .run(dbRow);
    return decode(dbRow);
  }

  listByIncident(incidentId: string): NotificationRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM notifications WHERE incident_id = ? ORDER BY created_at ASC`,
      )
      .all(incidentId) as NotificationDbRow[];
    return rows.map(decode);
  }
}
