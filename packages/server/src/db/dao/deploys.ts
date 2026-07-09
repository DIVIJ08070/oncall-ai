import type BetterSqlite3 from 'better-sqlite3';
import type { DeployRef, DeploySource } from '@oncall/shared';
import { newDeployId } from '../ids.js';
import { boolToInt, intToBool } from '../rows.js';

/**
 * `deploys` DAO (SPEC §8, §10.5, §11). Correlation between git history and
 * runtime failure/recovery. UNIQUE(customer_id, sha) — `upsert` is idempotent
 * per commit. `markCurrent` flips exactly one row to `is_current=1`.
 */

export interface UpsertDeployInput {
  customer_id: string;
  sha: string;
  short_sha: string;
  ref: string;
  message: string;
  author: string;
  committed_at: number;
  source: DeploySource;
  deployed_at?: number | null;
  is_current?: boolean;
  pr_id?: string | null;
  created_at?: number;
  id?: string;
}

interface DeployDbRow {
  id: string;
  customer_id: string;
  sha: string;
  short_sha: string;
  ref: string;
  message: string;
  author: string;
  committed_at: number;
  deployed_at: number | null;
  is_current: number;
  source: DeploySource;
  pr_id: string | null;
  created_at: number;
}

function decode(row: DeployDbRow): DeployRef {
  return { ...row, is_current: intToBool(row.is_current) };
}

export class DeploysDao {
  constructor(private readonly db: BetterSqlite3.Database) {}

  /** Insert, or update in place when (customer_id, sha) already exists. */
  upsert(input: UpsertDeployInput): DeployRef {
    const existing = this.getBySha(input.customer_id, input.sha);
    if (existing) {
      this.db
        .prepare(
          `UPDATE deploys
              SET short_sha = @short_sha, ref = @ref, message = @message, author = @author,
                  committed_at = @committed_at, deployed_at = @deployed_at,
                  is_current = @is_current, source = @source, pr_id = @pr_id
            WHERE customer_id = @customer_id AND sha = @sha`,
        )
        .run({
          customer_id: input.customer_id,
          sha: input.sha,
          short_sha: input.short_sha,
          ref: input.ref,
          message: input.message,
          author: input.author,
          committed_at: input.committed_at,
          deployed_at: input.deployed_at ?? null,
          is_current: boolToInt(input.is_current ?? existing.is_current),
          source: input.source,
          pr_id: input.pr_id ?? existing.pr_id ?? null,
        });
      return this.getBySha(input.customer_id, input.sha)!;
    }
    const dbRow: DeployDbRow = {
      id: input.id ?? newDeployId(),
      customer_id: input.customer_id,
      sha: input.sha,
      short_sha: input.short_sha,
      ref: input.ref,
      message: input.message,
      author: input.author,
      committed_at: input.committed_at,
      deployed_at: input.deployed_at ?? null,
      is_current: boolToInt(input.is_current ?? false),
      source: input.source,
      pr_id: input.pr_id ?? null,
      created_at: input.created_at ?? Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO deploys
           (id, customer_id, sha, short_sha, ref, message, author, committed_at,
            deployed_at, is_current, source, pr_id, created_at)
         VALUES
           (@id, @customer_id, @sha, @short_sha, @ref, @message, @author, @committed_at,
            @deployed_at, @is_current, @source, @pr_id, @created_at)`,
      )
      .run(dbRow);
    return decode(dbRow);
  }

  getBySha(customerId: string, sha: string): DeployRef | null {
    const row = this.db
      .prepare(`SELECT * FROM deploys WHERE customer_id = ? AND sha = ?`)
      .get(customerId, sha) as DeployDbRow | undefined;
    return row ? decode(row) : null;
  }

  getCurrent(customerId: string): DeployRef | null {
    const row = this.db
      .prepare(
        `SELECT * FROM deploys WHERE customer_id = ? AND is_current = 1
          ORDER BY committed_at DESC LIMIT 1`,
      )
      .get(customerId) as DeployDbRow | undefined;
    return row ? decode(row) : null;
  }

  listRecent(customerId: string, limit = 20): DeployRef[] {
    const cap = Math.min(Math.max(limit, 1), 100);
    const rows = this.db
      .prepare(
        `SELECT * FROM deploys WHERE customer_id = ?
          ORDER BY committed_at DESC LIMIT ?`,
      )
      .all(customerId, cap) as DeployDbRow[];
    return rows.map(decode);
  }

  /** Mark exactly one commit current for a customer (clears the rest). */
  markCurrent(customerId: string, sha: string): DeployRef | null {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE deploys SET is_current = 0 WHERE customer_id = ?`)
        .run(customerId);
      this.db
        .prepare(
          `UPDATE deploys SET is_current = 1 WHERE customer_id = ? AND sha = ?`,
        )
        .run(customerId, sha);
    });
    tx();
    return this.getBySha(customerId, sha);
  }
}
