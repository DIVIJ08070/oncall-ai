import type pg from 'pg';
import type {
  ApiRequestEndpoint,
  ApiRequestSamplesDao,
  ApiRequestWindowAgg,
  CreateApiRequestSampleInput,
} from '../../dao/types.js';

/**
 * `api_request_samples` DAO, postgres driver (AI Incident PREVENTION Phase 1).
 *
 * The raw per-request telemetry table the performance ticker aggregates from.
 * High-write (populated on the ingest hot path), short-lived (pruned by the
 * retention loop). `id` is a BIGSERIAL surrogate (int8 → JS number via the pool
 * parser). Every read here is a single grouped/bounded query (Rule 2).
 */

/** Latency (ms) at/above which a request is treated as a timeout by default. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Column order shared by the batch INSERT. */
const SAMPLE_COLS =
  'service_name, endpoint, method, timestamp, status_code, duration_ms, request_size, response_size';

export class PgApiRequestSamplesDao implements ApiRequestSamplesDao {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Batch insert raw samples in one multi-row `INSERT` (one round-trip). `id` is
   * DB-assigned (BIGSERIAL). Returns the number of rows written.
   */
  async insertMany(rows: CreateApiRequestSampleInput[]): Promise<number> {
    if (rows.length === 0) return 0;
    const values: string[] = [];
    const params: unknown[] = [];
    for (const r of rows) {
      const b = params.length;
      values.push(
        `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`,
      );
      params.push(
        r.service_name,
        r.endpoint,
        r.method ?? null,
        r.timestamp,
        r.status_code ?? null,
        r.duration_ms ?? null,
        r.request_size ?? null,
        r.response_size ?? null,
      );
    }
    const res = await this.pool.query(
      `INSERT INTO api_request_samples (${SAMPLE_COLS}) VALUES ${values.join(', ')}`,
      params,
    );
    return res.rowCount ?? 0;
  }

  /**
   * Roll one endpoint's window up in a single grouped query (Rule 2). Returns
   * the request count, error/timeout counts, and the raw latency array for
   * JS-side percentile computation.
   */
  async aggregateWindow(
    service: string,
    endpoint: string,
    fromTs: number,
    toTs: number,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<ApiRequestWindowAgg> {
    const res = await this.pool.query<{
      count: number | string;
      error_count: number | string;
      timeout_count: number | string;
      durations: Array<number | string> | null;
    }>(
      `SELECT
         COUNT(*) AS count,
         COUNT(*) FILTER (WHERE status_code IS NOT NULL AND status_code >= 500)
           AS error_count,
         COUNT(*) FILTER (WHERE status_code = 504
                             OR (duration_ms IS NOT NULL AND duration_ms > $5))
           AS timeout_count,
         COALESCE(
           array_agg(duration_ms::double precision)
             FILTER (WHERE duration_ms IS NOT NULL),
           ARRAY[]::double precision[]
         ) AS durations
       FROM api_request_samples
       WHERE service_name = $1 AND endpoint = $2
         AND timestamp >= $3 AND timestamp <= $4`,
      [service, endpoint, fromTs, toTs, timeoutMs],
    );
    const row = res.rows[0];
    if (!row) return { count: 0, errorCount: 0, timeoutCount: 0, durations: [] };
    return {
      count: Number(row.count),
      errorCount: Number(row.error_count),
      timeoutCount: Number(row.timeout_count),
      durations: (row.durations ?? []).map((v) => Number(v)),
    };
  }

  /**
   * Distinct (service, endpoint) seen in the window, each with its most-recent
   * `method` (via `DISTINCT ON`), so the ticker processes exactly one row per
   * endpoint (matching the `api_performance_samples` unique key).
   */
  async listEndpointsInWindow(
    fromTs: number,
    toTs: number,
  ): Promise<ApiRequestEndpoint[]> {
    const res = await this.pool.query<ApiRequestEndpoint>(
      `SELECT DISTINCT ON (service_name, endpoint)
         service_name, endpoint, method
       FROM api_request_samples
       WHERE timestamp >= $1 AND timestamp <= $2
       ORDER BY service_name, endpoint, timestamp DESC`,
      [fromTs, toTs],
    );
    return res.rows;
  }

  /**
   * Delete rows older than `cutoffTs` in bounded batches until the tail is
   * drained (postgres equivalent of the chunked prune). Each iteration deletes
   * up to `batchSize` rows by id; the loop stops once a batch comes back short
   * (nothing older remains). Returns the total rows deleted.
   */
  async pruneOlderThanInBatches(
    cutoffTs: number,
    batchSize = 500,
  ): Promise<number> {
    const size = Math.max(1, Math.floor(batchSize));
    let total = 0;
    for (;;) {
      const res = await this.pool.query(
        `DELETE FROM api_request_samples
          WHERE id IN (
            SELECT id FROM api_request_samples
             WHERE timestamp < $1
             ORDER BY id
             LIMIT $2
          )`,
        [cutoffTs, size],
      );
      const deleted = res.rowCount ?? 0;
      total += deleted;
      if (deleted < size) break;
    }
    return total;
  }
}
