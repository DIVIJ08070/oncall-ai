import type BetterSqlite3 from 'better-sqlite3';
import type { MetricSample } from '@oncall/shared';

/**
 * `metric_samples` DAO (SPEC §8, FR-04). One row per detection tick. This is
 * the only table with an INTEGER AUTOINCREMENT PK (no ULID) — `insert` returns
 * the row with its assigned `id`.
 */

export type CreateMetricSampleInput = Omit<MetricSample, 'id'>;

export class MetricSamplesDao {
  constructor(private readonly db: BetterSqlite3.Database) {}

  insert(input: CreateMetricSampleInput): MetricSample {
    const info = this.db
      .prepare(
        `INSERT INTO metric_samples
           (customer_id, service, bucket_ts, window_sec, request_count, error_count,
            error_rate, p50_ms, p95_ms, p99_ms)
         VALUES
           (@customer_id, @service, @bucket_ts, @window_sec, @request_count, @error_count,
            @error_rate, @p50_ms, @p95_ms, @p99_ms)`,
      )
      .run(input);
    return { ...input, id: Number(info.lastInsertRowid) };
  }

  /** Most recent sample for a service (highest `bucket_ts`). */
  latestForService(customerId: string, service: string): MetricSample | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM metric_samples
            WHERE customer_id = ? AND service = ?
            ORDER BY bucket_ts DESC LIMIT 1`,
        )
        .get(customerId, service) as MetricSample | undefined) ?? null
    );
  }

  /** Ascending time series for a service since `sinceTs` (capped by `limit`). */
  seriesForService(
    customerId: string,
    service: string,
    sinceTs: number,
    limit = 240,
  ): MetricSample[] {
    const cap = Math.min(Math.max(limit, 1), 240);
    const rows = this.db
      .prepare(
        `SELECT * FROM metric_samples
          WHERE customer_id = ? AND service = ? AND bucket_ts >= ?
          ORDER BY bucket_ts DESC LIMIT ?`,
      )
      .all(customerId, service, sinceTs, cap) as MetricSample[];
    return rows.reverse();
  }
}
