import type BetterSqlite3 from 'better-sqlite3';
import type { LogLevel } from '@oncall/shared';
import { newLogEventId } from '../ids.js';
import type { LogEventRow } from '../rows.js';

/**
 * `log_events` DAO (SPEC §8, FR-03). High-write path — statements are prepared
 * once and batch inserts run inside a single transaction. `stack` is truncated
 * to 8 KB on write per §8.
 */

/** SPEC §8: `stack` "truncated to 8KB on write". */
export const STACK_MAX_BYTES = 8 * 1024;

export interface CreateLogEventInput {
  customer_id: string;
  service: string;
  level: LogLevel;
  message: string;
  timestamp?: number;
  received_at?: number;
  stack?: string | null;
  endpoint?: string | null;
  method?: string | null;
  status?: number | null;
  latency_ms?: number | null;
  fingerprint_sig?: string | null;
  id?: string;
}

export interface LogQuery {
  customer_id?: string;
  service?: string;
  level?: LogLevel;
  since?: number;
  until?: number;
  /** Keyset pagination: only rows with `timestamp < before`. */
  before?: number;
  limit?: number;
}

/** Truncate a string to at most `STACK_MAX_BYTES` UTF-8 bytes. */
export function truncateStack(stack: string | null | undefined): string | null {
  if (stack === null || stack === undefined) return null;
  const buf = Buffer.from(stack, 'utf8');
  if (buf.length <= STACK_MAX_BYTES) return stack;
  // Slice on a byte boundary, then repair any split multibyte tail.
  return buf.subarray(0, STACK_MAX_BYTES).toString('utf8');
}

export class LogEventsDao {
  private _insertStmt?: BetterSqlite3.Statement;

  constructor(private readonly db: BetterSqlite3.Database) {}

  /** Lazily prepared so DAO construction never requires the schema to exist. */
  private get insertStmt(): BetterSqlite3.Statement {
    return (this._insertStmt ??= this.db.prepare(
      `INSERT INTO log_events
         (id, customer_id, service, timestamp, received_at, level, message,
          stack, endpoint, method, status, latency_ms, fingerprint_sig)
       VALUES
         (@id, @customer_id, @service, @timestamp, @received_at, @level, @message,
          @stack, @endpoint, @method, @status, @latency_ms, @fingerprint_sig)`,
    ));
  }

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

  insert(input: CreateLogEventInput): LogEventRow {
    const row = this.toRow(input);
    this.insertStmt.run(row);
    return row;
  }

  /** Batch insert in one transaction (ingest accepts ≤500 events/request). */
  insertMany(inputs: CreateLogEventInput[]): LogEventRow[] {
    const rows = inputs.map((i) => this.toRow(i));
    const tx = this.db.transaction((batch: LogEventRow[]) => {
      for (const r of batch) this.insertStmt.run(r);
    });
    tx(rows);
    return rows;
  }

  getById(id: string): LogEventRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM log_events WHERE id = ?`)
        .get(id) as LogEventRow | undefined) ?? null
    );
  }

  /** Filtered log query, newest-first, keyset-paginated by `timestamp`. */
  query(q: LogQuery = {}): LogEventRow[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (q.customer_id !== undefined) {
      where.push('customer_id = @customer_id');
      params.customer_id = q.customer_id;
    }
    if (q.service !== undefined) {
      where.push('service = @service');
      params.service = q.service;
    }
    if (q.level !== undefined) {
      where.push('level = @level');
      params.level = q.level;
    }
    if (q.since !== undefined) {
      where.push('timestamp >= @since');
      params.since = q.since;
    }
    if (q.until !== undefined) {
      where.push('timestamp <= @until');
      params.until = q.until;
    }
    if (q.before !== undefined) {
      where.push('timestamp < @before');
      params.before = q.before;
    }
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    params.limit = limit;
    const sql =
      `SELECT * FROM log_events` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY timestamp DESC, id DESC LIMIT @limit`;
    return this.db.prepare(sql).all(params) as LogEventRow[];
  }

  countByCustomer(customerId: string): number {
    const r = this.db
      .prepare(`SELECT COUNT(*) AS n FROM log_events WHERE customer_id = ?`)
      .get(customerId) as { n: number };
    return r.n;
  }
}
