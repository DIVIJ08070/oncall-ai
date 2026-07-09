import type BetterSqlite3 from 'better-sqlite3';
import type { EvidenceRef } from '@oncall/shared';
import { newChatMessageId } from '../ids.js';
import type { ChatMessageRow, ChatRole } from '../rows.js';
import { fromJson, toJson } from '../rows.js';

/**
 * `chat_messages` DAO (SPEC §8, FR-16). Per-incident chat transcript;
 * `evidence` persists as JSON TEXT and is parsed back on read. `incident_id`
 * is nullable (general chat not tied to an incident).
 */

export interface CreateChatMessageInput {
  incident_id: string | null;
  role: ChatRole;
  content: string;
  evidence?: EvidenceRef[] | null;
  created_at?: number;
  id?: string;
}

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

export class ChatMessagesDao {
  constructor(private readonly db: BetterSqlite3.Database) {}

  insert(input: CreateChatMessageInput): ChatMessageRow {
    const dbRow: ChatDbRow = {
      id: input.id ?? newChatMessageId(),
      incident_id: input.incident_id,
      role: input.role,
      content: input.content,
      evidence: toJson(input.evidence),
      created_at: input.created_at ?? Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO chat_messages (id, incident_id, role, content, evidence, created_at)
         VALUES (@id, @incident_id, @role, @content, @evidence, @created_at)`,
      )
      .run(dbRow);
    return decode(dbRow);
  }

  listByIncident(incidentId: string): ChatMessageRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM chat_messages WHERE incident_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(incidentId) as ChatDbRow[];
    return rows.map(decode);
  }
}
