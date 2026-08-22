import type pg from 'pg';
import type { Session } from '@oncall/shared';
import { newSessionId } from '../../ids.js';
import type {
  CreateSessionInput,
  FinishSessionFields,
  InvestigationSessionsDao,
  SessionPatch,
} from '../../dao/types.js';

/**
 * `investigation_sessions` DAO, postgres driver (FR-06/08). Same contract +
 * row shapes as the sqlite driver.
 */

const PATCHABLE_COLUMNS: (keyof SessionPatch)[] = [
  'status',
  'completed_at',
  'iterations',
  'root_cause',
  'confidence',
  'decision',
  'summary',
  'input_tokens',
  'output_tokens',
  'cost_usd',
];

export class PgInvestigationSessionsDao implements InvestigationSessionsDao {
  constructor(private readonly pool: pg.Pool) {}

  async create(input: CreateSessionInput): Promise<Session> {
    const row: Session = {
      id: input.id ?? newSessionId(),
      incident_id: input.incident_id,
      status: input.status ?? 'running',
      mode: input.mode,
      model: input.model,
      started_at: input.started_at ?? Date.now(),
      completed_at: null,
      iterations: input.iterations ?? 0,
      root_cause: null,
      confidence: null,
      decision: null,
      summary: null,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
    };
    await this.pool.query(
      `INSERT INTO investigation_sessions
         (id, incident_id, status, mode, model, started_at, completed_at, iterations,
          root_cause, confidence, decision, summary, input_tokens, output_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        row.id,
        row.incident_id,
        row.status,
        row.mode,
        row.model,
        row.started_at,
        row.completed_at,
        row.iterations,
        row.root_cause,
        row.confidence,
        row.decision,
        row.summary,
        row.input_tokens,
        row.output_tokens,
        row.cost_usd,
      ],
    );
    return row;
  }

  async getById(id: string): Promise<Session | null> {
    const res = await this.pool.query<Session>(
      `SELECT * FROM investigation_sessions WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  /** Most recent session for an incident. */
  async latestForIncident(incidentId: string): Promise<Session | null> {
    const res = await this.pool.query<Session>(
      `SELECT * FROM investigation_sessions
        WHERE incident_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [incidentId],
    );
    return res.rows[0] ?? null;
  }

  async listByIncident(incidentId: string): Promise<Session[]> {
    const res = await this.pool.query<Session>(
      `SELECT * FROM investigation_sessions
        WHERE incident_id = $1 ORDER BY started_at ASC`,
      [incidentId],
    );
    return res.rows;
  }

  async update(id: string, patch: SessionPatch): Promise<Session | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const col of PATCHABLE_COLUMNS) {
      if (col in patch && patch[col] !== undefined) {
        params.push(patch[col]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.getById(id);
    const res = await this.pool.query<Session>(
      `UPDATE investigation_sessions SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    return res.rows[0] ?? null;
  }

  /** Convenience for the terminal `submit_findings` write (FR-08). */
  async finish(id: string, fields: FinishSessionFields): Promise<Session | null> {
    return this.update(id, {
      ...fields,
      completed_at: fields.completed_at ?? Date.now(),
    });
  }
}
