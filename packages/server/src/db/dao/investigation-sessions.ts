import type BetterSqlite3 from 'better-sqlite3';
import type {
  Confidence,
  Decision,
  Session,
  SessionMode,
  SessionStatus,
} from '@oncall/shared';
import { newSessionId } from '../ids.js';

/**
 * `investigation_sessions` DAO (SPEC §8, FR-06/08). One agent run per incident
 * (re-triggerable). `create` starts a `running` session; `update` records the
 * terminal `submit_findings` output (root_cause, confidence, decision) + usage.
 */

export interface CreateSessionInput {
  incident_id: string;
  mode: SessionMode;
  model: string;
  status?: SessionStatus;
  started_at?: number;
  iterations?: number;
  id?: string;
}

export type SessionPatch = Partial<
  Pick<
    Session,
    | 'status'
    | 'completed_at'
    | 'iterations'
    | 'root_cause'
    | 'confidence'
    | 'decision'
    | 'summary'
    | 'input_tokens'
    | 'output_tokens'
    | 'cost_usd'
  >
>;

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

export class InvestigationSessionsDao {
  constructor(private readonly db: BetterSqlite3.Database) {}

  create(input: CreateSessionInput): Session {
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
    this.db
      .prepare(
        `INSERT INTO investigation_sessions
           (id, incident_id, status, mode, model, started_at, completed_at, iterations,
            root_cause, confidence, decision, summary, input_tokens, output_tokens, cost_usd)
         VALUES
           (@id, @incident_id, @status, @mode, @model, @started_at, @completed_at, @iterations,
            @root_cause, @confidence, @decision, @summary, @input_tokens, @output_tokens, @cost_usd)`,
      )
      .run(row);
    return row;
  }

  getById(id: string): Session | null {
    return (
      (this.db
        .prepare(`SELECT * FROM investigation_sessions WHERE id = ?`)
        .get(id) as Session | undefined) ?? null
    );
  }

  /** Most recent session for an incident. */
  latestForIncident(incidentId: string): Session | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM investigation_sessions
            WHERE incident_id = ? ORDER BY started_at DESC LIMIT 1`,
        )
        .get(incidentId) as Session | undefined) ?? null
    );
  }

  listByIncident(incidentId: string): Session[] {
    return this.db
      .prepare(
        `SELECT * FROM investigation_sessions
          WHERE incident_id = ? ORDER BY started_at ASC`,
      )
      .all(incidentId) as Session[];
  }

  update(id: string, patch: SessionPatch): Session | null {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    for (const col of PATCHABLE_COLUMNS) {
      if (col in patch && patch[col] !== undefined) {
        sets.push(`${col} = @${col}`);
        params[col] = patch[col];
      }
    }
    if (sets.length === 0) return this.getById(id);
    this.db
      .prepare(`UPDATE investigation_sessions SET ${sets.join(', ')} WHERE id = @id`)
      .run(params);
    return this.getById(id);
  }

  /** Convenience for the terminal `submit_findings` write (FR-08). */
  finish(
    id: string,
    fields: {
      status: SessionStatus;
      root_cause?: string | null;
      confidence?: Confidence | null;
      decision?: Decision | null;
      summary?: string | null;
      iterations?: number;
      input_tokens?: number;
      output_tokens?: number;
      cost_usd?: number;
      completed_at?: number;
    },
  ): Session | null {
    return this.update(id, {
      ...fields,
      completed_at: fields.completed_at ?? Date.now(),
    });
  }
}
