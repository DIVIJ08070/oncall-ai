import type pg from 'pg';
import { newServiceId } from '../../ids.js';
import type { ServiceRow } from '../../rows.js';
import type { ServicesDao } from '../../dao/types.js';

/**
 * `services` DAO, postgres driver. `touch` uses a native
 * `ON CONFLICT (customer_id, name) DO UPDATE` upsert (the sqlite driver's
 * select-then-write, made atomic): `last_event_at` only moves forward,
 * `first_event_at` only backward — identical net semantics.
 */
export class PgServicesDao implements ServicesDao {
  constructor(private readonly pool: pg.Pool) {}

  async getByName(customerId: string, name: string): Promise<ServiceRow | null> {
    const res = await this.pool.query<ServiceRow>(
      `SELECT * FROM services WHERE customer_id = $1 AND name = $2`,
      [customerId, name],
    );
    return res.rows[0] ?? null;
  }

  async getById(id: string): Promise<ServiceRow | null> {
    const res = await this.pool.query<ServiceRow>(
      `SELECT * FROM services WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async listByCustomer(customerId: string): Promise<ServiceRow[]> {
    const res = await this.pool.query<ServiceRow>(
      `SELECT * FROM services WHERE customer_id = $1 ORDER BY name ASC`,
      [customerId],
    );
    return res.rows;
  }

  /**
   * Upsert a service and advance timestamps. Idempotent per (customer, name):
   * inserts on first sight (`first_event_at` = `last_event_at` = `eventAt`),
   * otherwise moves `last_event_at` forward (never backward).
   */
  async touch(
    customerId: string,
    name: string,
    eventAt: number,
  ): Promise<ServiceRow> {
    const res = await this.pool.query<ServiceRow>(
      `INSERT INTO services (id, customer_id, name, first_event_at, last_event_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (customer_id, name) DO UPDATE SET
         last_event_at  = GREATEST(COALESCE(services.last_event_at, 0), EXCLUDED.last_event_at),
         first_event_at = LEAST(COALESCE(services.first_event_at, EXCLUDED.first_event_at), EXCLUDED.first_event_at)
       RETURNING *`,
      [newServiceId(), customerId, name, eventAt],
    );
    return res.rows[0]!;
  }
}
