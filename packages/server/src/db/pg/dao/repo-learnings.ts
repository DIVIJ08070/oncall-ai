import type pg from 'pg';
import { newRepoLearningId } from '../../ids.js';
import type { RepoLearningRow } from '../../rows.js';
import type {
  CreateRepoLearningInput,
  RepoLearningStats,
  RepoLearningsDao,
} from '../../dao/types.js';

/**
 * `repo_learnings` DAO, postgres driver (self-learning). `confirmOrCreate`
 * dedupes on repo + error_class + root_cause (case-insensitive), exactly as
 * under sqlite.
 */

/** Default page size for `listByRepo` when no limit is given. */
const DEFAULT_LIST_LIMIT = 100;

export class PgRepoLearningsDao implements RepoLearningsDao {
  constructor(private readonly pool: pg.Pool) {}

  async create(input: CreateRepoLearningInput): Promise<RepoLearningRow> {
    const now = input.created_at ?? Date.now();
    const row: RepoLearningRow = {
      id: input.id ?? newRepoLearningId(),
      repo: input.repo,
      error_class: input.error_class,
      root_cause: input.root_cause,
      fix_approach: input.fix_approach ?? null,
      source: input.source,
      rating: input.rating ?? 0,
      note: input.note ?? null,
      confirmations: 1,
      pr_number: input.pr_number ?? null,
      created_at: now,
      updated_at: now,
    };
    await this.pool.query(
      `INSERT INTO repo_learnings
         (id, repo, error_class, root_cause, fix_approach, source, rating, note,
          confirmations, pr_number, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        row.id,
        row.repo,
        row.error_class,
        row.root_cause,
        row.fix_approach,
        row.source,
        row.rating,
        row.note,
        row.confirmations,
        row.pr_number,
        row.created_at,
        row.updated_at,
      ],
    );
    return row;
  }

  async getById(id: string): Promise<RepoLearningRow | null> {
    const res = await this.pool.query<RepoLearningRow>(
      `SELECT * FROM repo_learnings WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  /** Newest-first learnings for a repo (dashboard list). */
  async listByRepo(
    repo: string,
    limit = DEFAULT_LIST_LIMIT,
  ): Promise<RepoLearningRow[]> {
    const res = await this.pool.query<RepoLearningRow>(
      `SELECT * FROM repo_learnings WHERE repo = $1
        ORDER BY updated_at DESC, id DESC LIMIT $2`,
      [repo, limit],
    );
    return res.rows;
  }

  /**
   * The `n` strongest learnings for prompt injection: positively-rated rows
   * first, then most-confirmed, then most recently updated.
   */
  async topForPrompt(repo: string, n: number): Promise<RepoLearningRow[]> {
    const res = await this.pool.query<RepoLearningRow>(
      `SELECT * FROM repo_learnings WHERE repo = $1
        ORDER BY (CASE WHEN rating > 0 THEN 0 ELSE 1 END) ASC,
                 confirmations DESC, updated_at DESC
        LIMIT $2`,
      [repo, n],
    );
    return res.rows;
  }

  async stats(repo: string): Promise<RepoLearningStats> {
    const totals = await this.pool.query<{
      total: number;
      positive: number;
      negative: number;
    }>(
      `SELECT COUNT(*)                                        AS total,
              COALESCE(SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END), 0) AS positive,
              COALESCE(SUM(CASE WHEN rating < 0 THEN 1 ELSE 0 END), 0) AS negative
         FROM repo_learnings WHERE repo = $1`,
      [repo],
    );
    const sourceRows = await this.pool.query<{ source: string; count: number }>(
      `SELECT source, COUNT(*) AS count FROM repo_learnings
        WHERE repo = $1 GROUP BY source`,
      [repo],
    );
    const bySource: Record<string, number> = {};
    for (const row of sourceRows.rows) bySource[row.source] = Number(row.count);
    const t = totals.rows[0]!;
    return {
      total: Number(t.total),
      positive: Number(t.positive),
      negative: Number(t.negative),
      bySource,
    };
  }

  /**
   * Reinforce an existing learning or record a new one. A row matches on
   * repo + error_class + root_cause (case-insensitive). On a match:
   * `confirmations` +1, `rating` moves one step toward the new signal,
   * `updated_at` is bumped, and a `fix_approach` fills in if it was missing.
   * Otherwise a fresh row is created.
   */
  async confirmOrCreate(
    input: CreateRepoLearningInput,
  ): Promise<RepoLearningRow> {
    const found = await this.pool.query<RepoLearningRow>(
      `SELECT * FROM repo_learnings
        WHERE repo = $1
          AND LOWER(error_class) = LOWER($2)
          AND LOWER(root_cause) = LOWER($3)
        LIMIT 1`,
      [input.repo, input.error_class, input.root_cause],
    );
    const existing = found.rows[0];
    if (!existing) return this.create(input);

    const signal = input.rating ?? 0;
    const rating = existing.rating + Math.sign(signal - existing.rating);
    const fixApproach = existing.fix_approach ?? input.fix_approach ?? null;
    const updatedAt = input.created_at ?? Date.now();
    await this.pool.query(
      `UPDATE repo_learnings
          SET confirmations = confirmations + 1, rating = $2,
              fix_approach = $3, updated_at = $4
        WHERE id = $1`,
      [existing.id, rating, fixApproach, updatedAt],
    );
    return {
      ...existing,
      confirmations: existing.confirmations + 1,
      rating,
      fix_approach: fixApproach,
      updated_at: updatedAt,
    };
  }
}
