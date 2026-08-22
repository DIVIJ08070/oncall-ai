import type pg from 'pg';
import type { EvidenceRef } from '@oncall/shared';
import { newChatMessageId } from '../../ids.js';
import type { ChatMessageRow, ChatRole } from '../../rows.js';
import { fromJson, toJson } from '../../rows.js';
import type {
  ChatMessagesDao,
  CreateChatMessageInput,
} from '../../dao/types.js';

/**
 * `chat_messages` DAO, postgres driver (FR-16). `evidence` persists as JSON
 * TEXT and is parsed back on read, exactly as under sqlite.
 */

interface ChatDbRow {
  id: string;
  incident_id: string | null;
  role: ChatRole;
  content: string;
  evidence: string | null;
  created_at: number;
}

function decode(row: ChatDbRow): ChatMessageRow {
  return {
    id: row.id,
    incident_id: row.incident_id,
    role: row.role,
    content: row.content,
    evidence: fromJson<EvidenceRef[]>(row.evidence),
    created_at: row.created_at,
  };
}

export class PgChatMessagesDao implements ChatMessagesDao {
  constructor(private readonly pool: pg.Pool) {}

  async insert(input: CreateChatMessageInput): Promise<ChatMessageRow> {
    const dbRow: ChatDbRow = {
      id: input.id ?? newChatMessageId(),
      incident_id: input.incident_id,
      role: input.role,
      content: input.content,
      evidence: toJson(input.evidence),
      created_at: input.created_at ?? Date.now(),
    };
    await this.pool.query(
      `INSERT INTO chat_messages (id, incident_id, role, content, evidence, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        dbRow.id,
        dbRow.incident_id,
        dbRow.role,
        dbRow.content,
        dbRow.evidence,
        dbRow.created_at,
      ],
    );
    return decode(dbRow);
  }

  async listByIncident(incidentId: string): Promise<ChatMessageRow[]> {
    const res = await this.pool.query<ChatDbRow>(
      // Stable order: `created_at` then `id` (monotonic ULIDs — BUG-006).
      `SELECT * FROM chat_messages WHERE incident_id = $1
        ORDER BY created_at ASC, id ASC`,
      [incidentId],
    );
    return res.rows.map(decode);
  }
}
