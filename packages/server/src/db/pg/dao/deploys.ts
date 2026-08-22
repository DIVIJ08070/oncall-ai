import type pg from 'pg';
import type { DeployRef, DeploySource } from '@oncall/shared';
import { newDeployId } from '../../ids.js';
import { boolToInt, intToBool } from '../../rows.js';
import type { DeploysDao, UpsertDeployInput } from '../../dao/types.js';
import { withTransaction, type Queryable } from '../pool.js';

/**
 * `deploys` DAO, postgres driver (SPEC §8, §10.5, §11).
 * UNIQUE(customer_id, sha) — `upsert` is idempotent per commit and preserves
 * `is_current`/`pr_id` when the new input omits them (sqlite-driver parity).
 * `markCurrent` flips exactly one row to `is_current=1` in a transaction.
 * `is_current` persists as a 0/1 integer on both drivers (shared codecs).
 */

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

export class PgDeploysDao implements DeploysDao {
  constructor(private readonly pool: pg.Pool) {}

  /** Insert, or update in place when (customer_id, sha) already exists. */
  async upsert(input: UpsertDeployInput): Promise<DeployRef> {
    const existing = await this.getBySha(input.customer_id, input.sha);
    if (existing) {
      const res = await this.pool.query<DeployDbRow>(
        `UPDATE deploys
            SET short_sha = $3, ref = $4, message = $5, author = $6,
                committed_at = $7, deployed_at = $8, is_current = $9,
                source = $10, pr_id = $11
          WHERE customer_id = $1 AND sha = $2
          RETURNING *`,
        [
          input.customer_id,
          input.sha,
          input.short_sha,
          input.ref,
          input.message,
          input.author,
          input.committed_at,
          input.deployed_at ?? null,
          boolToInt(input.is_current ?? existing.is_current),
          input.source,
          input.pr_id ?? existing.pr_id ?? null,
        ],
      );
      return decode(res.rows[0]!);
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
    await this.pool.query(
      `INSERT INTO deploys
         (id, customer_id, sha, short_sha, ref, message, author, committed_at,
          deployed_at, is_current, source, pr_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        dbRow.id,
        dbRow.customer_id,
        dbRow.sha,
        dbRow.short_sha,
        dbRow.ref,
        dbRow.message,
        dbRow.author,
        dbRow.committed_at,
        dbRow.deployed_at,
        dbRow.is_current,
        dbRow.source,
        dbRow.pr_id,
        dbRow.created_at,
      ],
    );
    return decode(dbRow);
  }

  private async getByShaOn(
    q: Queryable,
    customerId: string,
    sha: string,
  ): Promise<DeployRef | null> {
    const res = await q.query<DeployDbRow>(
      `SELECT * FROM deploys WHERE customer_id = $1 AND sha = $2`,
      [customerId, sha],
    );
    return res.rows[0] ? decode(res.rows[0]) : null;
  }

  async getBySha(customerId: string, sha: string): Promise<DeployRef | null> {
    return this.getByShaOn(this.pool, customerId, sha);
  }

  async getCurrent(customerId: string): Promise<DeployRef | null> {
    const res = await this.pool.query<DeployDbRow>(
      `SELECT * FROM deploys WHERE customer_id = $1 AND is_current = 1
        ORDER BY committed_at DESC LIMIT 1`,
      [customerId],
    );
    return res.rows[0] ? decode(res.rows[0]) : null;
  }

  async listRecent(customerId: string, limit = 20): Promise<DeployRef[]> {
    const cap = Math.min(Math.max(limit, 1), 100);
    const res = await this.pool.query<DeployDbRow>(
      `SELECT * FROM deploys WHERE customer_id = $1
        ORDER BY committed_at DESC LIMIT $2`,
      [customerId, cap],
    );
    return res.rows.map(decode);
  }

  /** Mark exactly one commit current for a customer (clears the rest). */
  async markCurrent(customerId: string, sha: string): Promise<DeployRef | null> {
    return withTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE deploys SET is_current = 0 WHERE customer_id = $1`,
        [customerId],
      );
      await client.query(
        `UPDATE deploys SET is_current = 1 WHERE customer_id = $1 AND sha = $2`,
        [customerId, sha],
      );
      return this.getByShaOn(client, customerId, sha);
    });
  }
}
