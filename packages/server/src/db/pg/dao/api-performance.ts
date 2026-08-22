import type pg from 'pg';
import type { ApiPerformanceSampleRow } from '../../rows.js';
import type {
  ApiPerformanceDao,
  UpsertApiPerformanceSampleInput,
} from '../../dao/types.js';

/**
 * `api_performance_samples` DAO, postgres driver (AI Incident PREVENTION
 * Phase 1). One derived performance profile per (service, endpoint) per rollup
 * window. `id` is a BIGSERIAL surrogate (int8 → JS number via the pool parser);
 * `upsertWindow` is a native `ON CONFLICT (service_name, endpoint, window_start)
 * DO UPDATE` upsert so re-running a window overwrites in place.
 */
export class PgApiPerformanceDao implements ApiPerformanceDao {
  constructor(private readonly pool: pg.Pool) {}

  async upsertWindow(
    sample: UpsertApiPerformanceSampleInput,
  ): Promise<ApiPerformanceSampleRow> {
    const res = await this.pool.query<ApiPerformanceSampleRow>(
      `INSERT INTO api_performance_samples
         (service_name, endpoint, method, window_start, window_end,
          request_count, rps, p50_latency_ms, p95_latency_ms, p99_latency_ms,
          error_rate, timeout_rate, performance_score, risk_score, prediction)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (service_name, endpoint, window_start) DO UPDATE SET
         method            = EXCLUDED.method,
         window_end        = EXCLUDED.window_end,
         request_count     = EXCLUDED.request_count,
         rps               = EXCLUDED.rps,
         p50_latency_ms    = EXCLUDED.p50_latency_ms,
         p95_latency_ms    = EXCLUDED.p95_latency_ms,
         p99_latency_ms    = EXCLUDED.p99_latency_ms,
         error_rate        = EXCLUDED.error_rate,
         timeout_rate      = EXCLUDED.timeout_rate,
         performance_score = EXCLUDED.performance_score,
         risk_score        = EXCLUDED.risk_score,
         prediction        = EXCLUDED.prediction
       RETURNING *`,
      [
        sample.service_name,
        sample.endpoint,
        sample.method,
        sample.window_start,
        sample.window_end,
        sample.request_count,
        sample.rps,
        sample.p50_latency_ms,
        sample.p95_latency_ms,
        sample.p99_latency_ms,
        sample.error_rate,
        sample.timeout_rate,
        sample.performance_score,
        sample.risk_score,
        sample.prediction ?? null,
      ],
    );
    return res.rows[0]!;
  }

  /**
   * Most-recent sample per (service_name, endpoint) via `DISTINCT ON`. When
   * `customerScope` is given, restrict to those service names.
   */
  async latestPerService(
    customerScope?: readonly string[],
  ): Promise<ApiPerformanceSampleRow[]> {
    if (customerScope && customerScope.length > 0) {
      const res = await this.pool.query<ApiPerformanceSampleRow>(
        `SELECT DISTINCT ON (service_name, endpoint) *
           FROM api_performance_samples
          WHERE service_name = ANY($1)
          ORDER BY service_name, endpoint, window_start DESC`,
        [customerScope as string[]],
      );
      return res.rows;
    }
    const res = await this.pool.query<ApiPerformanceSampleRow>(
      `SELECT DISTINCT ON (service_name, endpoint) *
         FROM api_performance_samples
        ORDER BY service_name, endpoint, window_start DESC`,
    );
    return res.rows;
  }

  /** Newest-first window history for a single endpoint (capped by `limit`). */
  async listRecentForEndpoint(
    service: string,
    endpoint: string,
    limit = 60,
  ): Promise<ApiPerformanceSampleRow[]> {
    const cap = Math.min(Math.max(limit, 1), 1000);
    const res = await this.pool.query<ApiPerformanceSampleRow>(
      `SELECT * FROM api_performance_samples
        WHERE service_name = $1 AND endpoint = $2
        ORDER BY window_start DESC LIMIT $3`,
      [service, endpoint, cap],
    );
    return res.rows;
  }
}
