import type BetterSqlite3 from 'better-sqlite3';
import { newServiceId } from '../ids.js';
import type { ServiceRow } from '../rows.js';

/**
 * `services` DAO (SPEC §8). One row per (customer, service name); tracks
 * `first_event_at`/`last_event_at` for health + silence detection (FR-19).
 * `touch` is called on ingest to upsert the service and advance `last_event_at`.
 */

export class ServicesDao {
  constructor(private readonly db: BetterSqlite3.Database) {}

  getByName(customerId: string, name: string): ServiceRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM services WHERE customer_id = ? AND name = ?`)
        .get(customerId, name) as ServiceRow | undefined) ?? null
    );
  }

  getById(id: string): ServiceRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM services WHERE id = ?`)
        .get(id) as ServiceRow | undefined) ?? null
    );
  }

  listByCustomer(customerId: string): ServiceRow[] {
    return this.db
      .prepare(`SELECT * FROM services WHERE customer_id = ? ORDER BY name ASC`)
      .all(customerId) as ServiceRow[];
  }

  /**
   * Upsert a service and advance timestamps. Idempotent per (customer, name):
   * inserts on first sight (`first_event_at` = `last_event_at` = `eventAt`),
   * otherwise moves `last_event_at` forward (never backward).
   */
  touch(customerId: string, name: string, eventAt: number): ServiceRow {
    const existing = this.getByName(customerId, name);
    if (!existing) {
      const row: ServiceRow = {
        id: newServiceId(),
        customer_id: customerId,
        name,
        first_event_at: eventAt,
        last_event_at: eventAt,
      };
      this.db
        .prepare(
          `INSERT INTO services (id, customer_id, name, first_event_at, last_event_at)
           VALUES (@id, @customer_id, @name, @first_event_at, @last_event_at)`,
        )
        .run(row);
      return row;
    }
    this.db
      .prepare(
        `UPDATE services
            SET last_event_at = MAX(COALESCE(last_event_at, 0), @eventAt),
                first_event_at = MIN(COALESCE(first_event_at, @eventAt), @eventAt)
          WHERE customer_id = @customerId AND name = @name`,
      )
      .run({ customerId, name, eventAt });
    return this.getByName(customerId, name)!;
  }
}
