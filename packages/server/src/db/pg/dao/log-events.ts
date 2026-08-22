import type pg from 'pg';
import { newLogEventId } from '../../ids.js';
import type { LogEventRow } from '../../rows.js';
import { truncateStack } from '../../dao/types.js';
import type {
  CreateLogEventInput,
  LogEventsDao,
  LogQuery,
} from '../../dao/types.js';
import { withTransaction, type Queryable } from '../pool.js';

/**
 * `log_events` DAO, postgres driver (FR-03). High-write path — `insertMany`
 * runs the batch on one pooled client inside a single transaction. `stack` is
 * truncated to 8 KB on write per SPEC §8, exactly as under sqlite.
 */

const INSERT_SQL = `
  INSERT INTO log_events
    (id, customer_id, service, timestamp, received_at, level, message,
     stack, endpoint, method, status, latency_ms, fingerprint_sig)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`;

function insertParams(row: LogEventRow): unknown[] {
  return [
    row.id,
    row.customer_id,
    row.service,
    row.timestamp,
    row.received_at,
    row.level,
    row.message,
    row.stack,
    row.endpoint,
    row.method,
    row.status,
    row.latency_ms,
    row.fingerprint_sig,
  ];
}

export class PgLogEventsDao implements LogEventsDao {
  constructor(private readonly pool: pg.Pool) {}

  private toRow(input: CreateLogEventInput): LogEventRow {
    const received_at = input.received_at ?? Date.now();
    return {
      id: input.id ?? newLogEventId(),
      customer_id: input.customer_id,
      service: input.service,
      timestamp: input.timestamp ?? received_at,
      received_at,
      level: input.level,
      message: input.message,
      stack: truncateStack(input.stack),
      endpoint: input.endpoint ?? null,
      method: input.method ?? null,
      status: input.status ?? null,
      latency_ms: input.latency_ms ?? null,
      fingerprint_sig: input.fingerprint_sig ?? null,
    };
  }

  async insert(input: CreateLogEventInput): Promise<LogEventRow> {
    const row = this.toRow(input);
    await this.pool.query(INSERT_SQL, insertParams(row));
    return row;
  }

  /** Batch insert in one transaction (ingest accepts ≤500 events/request). */
  async insertMany(inputs: CreateLogEventInput[]): Promise<LogEventRow[]> {
    const rows = inputs.map((i) => this.toRow(i));
    if (rows.length === 0) return rows;
    await withTransaction(this.pool, async (client: Queryable) => {
      for (const r of rows) await client.query(INSERT_SQL, insertParams(r));
    });
    return rows;
  }

  async getById(id: string): Promise<LogEventRow | null> {
    const res = await this.pool.query<LogEventRow>(
      `SELECT * FROM log_events WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  /** Filtered log query, newest-first, keyset-paginated by `timestamp`. */
  async query(q: LogQuery = {}): Promise<LogEventRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    if (q.customer_id !== undefined)
      where.push(`customer_id = ${bind(q.customer_id)}`);
    if (q.service !== undefined) where.push(`service = ${bind(q.service)}`);
    if (q.level !== undefined) where.push(`level = ${bind(q.level)}`);
    if (q.since !== undefined) where.push(`timestamp >= ${bind(q.since)}`);
    if (q.until !== undefined) where.push(`timestamp <= ${bind(q.until)}`);
    if (q.before !== undefined) where.push(`timestamp < ${bind(q.before)}`);
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const sql =
      `SELECT * FROM log_events` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY timestamp DESC, id DESC LIMIT ${bind(limit)}`;
    const res = await this.pool.query<LogEventRow>(sql, params);
    return res.rows;
  }

  async countByCustomer(customerId: string): Promise<number> {
    const res = await this.pool.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM log_events WHERE customer_id = $1`,
      [customerId],
    );
    return res.rows[0]?.n ?? 0;
  }
}
