import type BetterSqlite3 from 'better-sqlite3';
import type { Step, StepType } from '@oncall/shared';
import { newStepId } from '../ids.js';
import { fromJson, toJson } from '../rows.js';

/**
 * `investigation_steps` DAO (SPEC §8, NFR-06). Append-only per session; `seq`
 * is auto-assigned (monotonic per session). `tool_input`/`tool_output` persist
 * as JSON TEXT and are parsed back on read, so callers work with real objects.
 */

export interface AppendStepInput {
  session_id: string;
  type: StepType;
  tool_name?: string | null;
  tool_input?: unknown;
  tool_output?: unknown;
  content?: string | null;
  /** Override the auto-assigned sequence (tests / replay). */
  seq?: number;
  created_at?: number;
  id?: string;
}

/** A step as stored, with `tool_input`/`tool_output` parsed from JSON. */
export interface StoredStep extends Step {
  id: string;
  session_id: string;
  seq: number;
  created_at: number;
}

interface StepDbRow {
  id: string;
  session_id: string;
  seq: number;
  type: StepType;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  content: string | null;
  created_at: number;
}

function decode(row: StepDbRow): StoredStep {
  return {
    id: row.id,
    session_id: row.session_id,
    seq: row.seq,
    type: row.type,
    tool_name: row.tool_name,
    tool_input: fromJson(row.tool_input),
    tool_output: fromJson(row.tool_output),
    content: row.content,
    created_at: row.created_at,
  };
}

export class InvestigationStepsDao {
  private _insertStmt?: BetterSqlite3.Statement;

  constructor(private readonly db: BetterSqlite3.Database) {}

  /** Lazily prepared so DAO construction never requires the schema to exist. */
  private get insertStmt(): BetterSqlite3.Statement {
    return (this._insertStmt ??= this.db.prepare(
      `INSERT INTO investigation_steps
         (id, session_id, seq, type, tool_name, tool_input, tool_output, content, created_at)
       VALUES
         (@id, @session_id, @seq, @type, @tool_name, @tool_input, @tool_output, @content, @created_at)`,
    ));
  }

  private nextSeq(sessionId: string): number {
    const r = this.db
      .prepare(
        `SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM investigation_steps WHERE session_id = ?`,
      )
      .get(sessionId) as { next: number };
    return r.next;
  }

  /** Append a step; assigns `seq` and `id` atomically. */
  append(input: AppendStepInput): StoredStep {
    const tx = this.db.transaction((data: AppendStepInput): StoredStep => {
      const seq = data.seq ?? this.nextSeq(data.session_id);
      const dbRow: StepDbRow = {
        id: data.id ?? newStepId(),
        session_id: data.session_id,
        seq,
        type: data.type,
        tool_name: data.tool_name ?? null,
        tool_input: toJson(data.tool_input),
        tool_output: toJson(data.tool_output),
        content: data.content ?? null,
        created_at: data.created_at ?? Date.now(),
      };
      this.insertStmt.run(dbRow);
      return decode(dbRow);
    });
    return tx(input);
  }

  listBySession(sessionId: string): StoredStep[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM investigation_steps WHERE session_id = ? ORDER BY seq ASC`,
      )
      .all(sessionId) as StepDbRow[];
    return rows.map(decode);
  }

  countBySession(sessionId: string): number {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM investigation_steps WHERE session_id = ?`,
      )
      .get(sessionId) as { n: number };
    return r.n;
  }
}
