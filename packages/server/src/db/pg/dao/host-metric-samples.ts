import type pg from 'pg';
import type { HostMetricSampleRow } from '../../rows.js';
import type {
  CreateHostMetricSampleInput,
  HostMetricColumn,
  HostMetricPoint,
  HostMetricSamplesDao,
} from '../../dao/types.js';

/**
 * `host_metric_samples` DAO, postgres driver (AI Incident PREVENTION — HOST
 * early warning). Raw per-tick host/process resource readings (CPU / memory /
 * DB-pool / event-loop lag) the host-ticker rolls up per (service, metric).
 * `id` is a BIGSERIAL surrogate (int8 → JS number via the pool parser). Every
 * read here is a single grouped/bounded query.
 */

/** Column order shared by the batch INSERT. */
const SAMPLE_COLS =
  'host, service, timestamp, cpu_pct, mem_pct, db_pool_pct, event_loop_lag_ms';

/** Whitelist of metric columns `recentSeries` may select (no SQL injection). */
const METRIC_COLUMNS: ReadonlySet<HostMetricColumn> = new Set<HostMetricColumn>([
  'cpu_pct',
  'mem_pct',
  'db_pool_pct',
]);

export class PgHostMetricSamplesDao implements HostMetricSamplesDao {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Batch insert raw host readings in one multi-row `INSERT` (one round-trip).
   * `id` is DB-assigned (BIGSERIAL). Returns the number of rows written.
   */
  async insertMany(rows: CreateHostMetricSampleInput[]): Promise<number> {
    if (rows.length === 0) return 0;
    const values: string[] = [];
    const params: unknown[] = [];
    for (const r of rows) {
      const b = params.length;
      values.push(
        `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`,
      );
      params.push(
        r.host,
        r.service,
        r.timestamp,
        r.cpu_pct ?? null,
        r.mem_pct ?? null,
        r.db_pool_pct ?? null,
        r.event_loop_lag_ms ?? null,
      );
    }
    const res = await this.pool.query(
      `INSERT INTO host_metric_samples (${SAMPLE_COLS}) VALUES ${values.join(', ')}`,
      params,
    );
    return res.rowCount ?? 0;
  }

  /** Distinct services with any sample in `[fromTs, toTs]`. */
  async listServicesInWindow(fromTs: number, toTs: number): Promise<string[]> {
    const res = await this.pool.query<{ service: string }>(
      `SELECT DISTINCT service
         FROM host_metric_samples
        WHERE timestamp >= $1 AND timestamp <= $2
        ORDER BY service`,
      [fromTs, toTs],
    );
    return res.rows.map((r) => r.service);
  }

  /**
   * Newest-first non-null readings of one metric column for one service. The
   * column is validated against a whitelist before interpolation, so the metric
   * name can never inject SQL.
   */
  async recentSeries(
    service: string,
    metric: HostMetricColumn,
    limit = 30,
  ): Promise<HostMetricPoint[]> {
    if (!METRIC_COLUMNS.has(metric)) {
      throw new Error(`invalid host metric column: ${metric}`);
    }
    const cap = Math.min(Math.max(Math.floor(limit), 1), 1000);
    const res = await this.pool.query<{ timestamp: number; value: number }>(
      `SELECT timestamp, ${metric} AS value
         FROM host_metric_samples
        WHERE service = $1 AND ${metric} IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT $2`,
      [service, cap],
    );
    return res.rows.map((r) => ({
      timestamp: Number(r.timestamp),
      value: Number(r.value),
    }));
  }

  /** The most-recent full sample row for a service (highest `timestamp`). */
  async latestForService(service: string): Promise<HostMetricSampleRow | null> {
    const res = await this.pool.query<HostMetricSampleRow>(
      `SELECT * FROM host_metric_samples
        WHERE service = $1
        ORDER BY timestamp DESC
        LIMIT 1`,
      [service],
    );
    return res.rows[0] ?? null;
  }
}
