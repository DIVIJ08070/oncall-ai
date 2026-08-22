import type pg from 'pg';
import type { RiskStateRow } from '../../rows.js';
import type { RiskStatesDao, UpsertRiskStateInput } from '../../dao/types.js';

/**
 * `risk_states` DAO, postgres driver (AI Incident PREVENTION Phase 1). Durable
 * per-(service, endpoint) escalation state. `id` is a BIGSERIAL surrogate
 * (int8 → JS number via the pool parser); `upsert` is a native
 * `ON CONFLICT (service_name, endpoint) DO UPDATE` upsert so each window's
 * recompute replaces the state in place.
 */
export class PgRiskStatesDao implements RiskStatesDao {
  constructor(private readonly pool: pg.Pool) {}

  async get(service: string, endpoint: string): Promise<RiskStateRow | null> {
    const res = await this.pool.query<RiskStateRow>(
      `SELECT * FROM risk_states WHERE service_name = $1 AND endpoint = $2`,
      [service, endpoint],
    );
    return res.rows[0] ?? null;
  }

  async upsert(state: UpsertRiskStateInput): Promise<RiskStateRow> {
    const res = await this.pool.query<RiskStateRow>(
      `INSERT INTO risk_states
         (service_name, endpoint, status, first_detected_at, last_escalated_at,
          consecutive_risk_windows, consecutive_healthy_windows,
          current_risk_score, prediction_details, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (service_name, endpoint) DO UPDATE SET
         status                      = EXCLUDED.status,
         first_detected_at           = EXCLUDED.first_detected_at,
         last_escalated_at           = EXCLUDED.last_escalated_at,
         consecutive_risk_windows    = EXCLUDED.consecutive_risk_windows,
         consecutive_healthy_windows = EXCLUDED.consecutive_healthy_windows,
         current_risk_score          = EXCLUDED.current_risk_score,
         prediction_details          = EXCLUDED.prediction_details,
         updated_at                  = EXCLUDED.updated_at
       RETURNING *`,
      [
        state.service_name,
        state.endpoint,
        state.status,
        state.first_detected_at ?? null,
        state.last_escalated_at ?? null,
        state.consecutive_risk_windows ?? 0,
        state.consecutive_healthy_windows ?? 0,
        state.current_risk_score ?? null,
        state.prediction_details ?? null,
        state.updated_at ?? Date.now(),
      ],
    );
    return res.rows[0]!;
  }

  /** Every tracked risk state (dashboard overview). */
  async listAll(): Promise<RiskStateRow[]> {
    const res = await this.pool.query<RiskStateRow>(
      `SELECT * FROM risk_states ORDER BY service_name ASC, endpoint ASC`,
    );
    return res.rows;
  }
}
