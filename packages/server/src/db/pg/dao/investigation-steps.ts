import type pg from 'pg';
import type { StepType } from '@oncall/shared';
import { newStepId } from '../../ids.js';
import { fromJson, toJson } from '../../rows.js';
import type {
  AppendStepInput,
  InvestigationStepsDao,
  StoredStep,
} from '../../dao/types.js';
import { withTransaction } from '../pool.js';

/**
 * `investigation_steps` DAO, postgres driver (NFR-06). Append-only per
 * session; `seq` is auto-assigned inside a transaction (monotonic per
 * session). `tool_input`/`tool_output` persist as JSON TEXT and are parsed
 * back on read, exactly as under sqlite.
 */

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

export class PgInvestigationStepsDao implements InvestigationStepsDao {
  constructor(private readonly pool: pg.Pool) {}

  /** Append a step; assigns `seq` and `id` atomically. */
  async append(input: AppendStepInput): Promise<StoredStep> {
    return withTransaction(this.pool, async (client): Promise<StoredStep> => {
      let seq = input.seq;
      if (seq === undefined) {
        const res = await client.query<{ next: number }>(
          `SELECT COALESCE(MAX(seq), -1) + 1 AS next
             FROM investigation_steps WHERE session_id = $1`,
          [input.session_id],
        );
        seq = res.rows[0]!.next;
      }
      const dbRow: StepDbRow = {
        id: input.id ?? newStepId(),
        session_id: input.session_id,
        seq,
        type: input.type,
        tool_name: input.tool_name ?? null,
        tool_input: toJson(input.tool_input),
        tool_output: toJson(input.tool_output),
        content: input.content ?? null,
        created_at: input.created_at ?? Date.now(),
      };
      await client.query(
        `INSERT INTO investigation_steps
           (id, session_id, seq, type, tool_name, tool_input, tool_output, content, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          dbRow.id,
          dbRow.session_id,
          dbRow.seq,
          dbRow.type,
          dbRow.tool_name,
          dbRow.tool_input,
          dbRow.tool_output,
          dbRow.content,
          dbRow.created_at,
        ],
      );
      return decode(dbRow);
    });
  }

  async listBySession(sessionId: string): Promise<StoredStep[]> {
    const res = await this.pool.query<StepDbRow>(
      `SELECT * FROM investigation_steps WHERE session_id = $1 ORDER BY seq ASC`,
      [sessionId],
    );
    return res.rows.map(decode);
  }

  async countBySession(sessionId: string): Promise<number> {
    const res = await this.pool.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM investigation_steps WHERE session_id = $1`,
      [sessionId],
    );
    return res.rows[0]?.n ?? 0;
  }
}
