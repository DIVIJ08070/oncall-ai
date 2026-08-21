import type BetterSqlite3 from 'better-sqlite3';
import { newRepoLearningId } from '../ids.js';
import type { LearningSource, RepoLearningRow } from '../rows.js';

/**
 * `repo_learnings` DAO (self-learning). One row per distinct learning a repo's
 * PR feedback produced (explicit 👍/👎 rating, or automatic merge/close/review
 * signals). `confirmOrCreate` dedupes on repo + error_class + root_cause
 * (case-insensitive) so repeated signals strengthen one row instead of piling
 * up duplicates; `topForPrompt` feeds the strongest learnings back into
 * investigation / code-review prompts.
 */

export interface CreateRepoLearningInput {
  /** GitHub repo as `owner/name`. */
  repo: string;
  error_class: string;
  root_cause: string;
  fix_approach?: string | null;
  source: LearningSource;
  /** Feedback signal, typically -1 or 1 (default 0). */
  rating?: number;
  note?: string | null;
  pr_number?: number | null;
  created_at?: number;
  id?: string;
}

export interface RepoLearningStats {
  total: number;
  positive: number;
  negative: number;
  bySource: Record<string, number>;
}

/** Default page size for `listByRepo` when no limit is given. */
const DEFAULT_LIST_LIMIT = 100;

export class RepoLearningsDao {
  constructor(private readonly db: BetterSqlite3.Database) {}

  create(input: CreateRepoLearningInput): RepoLearningRow {
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
    this.db
      .prepare(
        `INSERT INTO repo_learnings
           (id, repo, error_class, root_cause, fix_approach, source, rating, note,
            confirmations, pr_number, created_at, updated_at)
         VALUES
           (@id, @repo, @error_class, @root_cause, @fix_approach, @source, @rating, @note,
            @confirmations, @pr_number, @created_at, @updated_at)`,
      )
      .run(row);
    return row;
  }

  getById(id: string): RepoLearningRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM repo_learnings WHERE id = ?`)
        .get(id) as RepoLearningRow | undefined) ?? null
    );
  }

  /** Newest-first learnings for a repo (dashboard list). */
  listByRepo(repo: string, limit = DEFAULT_LIST_LIMIT): RepoLearningRow[] {
    return this.db
      .prepare(
        `SELECT * FROM repo_learnings WHERE repo = ?
          ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(repo, limit) as RepoLearningRow[];
  }

  /**
   * The `n` strongest learnings for prompt injection: positively-rated rows
   * first, then most-confirmed, then most recently updated.
   */
  topForPrompt(repo: string, n: number): RepoLearningRow[] {
    return this.db
      .prepare(
        `SELECT * FROM repo_learnings WHERE repo = ?
          ORDER BY (CASE WHEN rating > 0 THEN 0 ELSE 1 END) ASC,
                   confirmations DESC, updated_at DESC
          LIMIT ?`,
      )
      .all(repo, n) as RepoLearningRow[];
  }

  stats(repo: string): RepoLearningStats {
    const totals = this.db
      .prepare(
        `SELECT COUNT(*)                                        AS total,
                COALESCE(SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END), 0) AS positive,
                COALESCE(SUM(CASE WHEN rating < 0 THEN 1 ELSE 0 END), 0) AS negative
           FROM repo_learnings WHERE repo = ?`,
      )
      .get(repo) as { total: number; positive: number; negative: number };
    const sourceRows = this.db
      .prepare(
        `SELECT source, COUNT(*) AS count FROM repo_learnings
          WHERE repo = ? GROUP BY source`,
      )
      .all(repo) as Array<{ source: string; count: number }>;
    const bySource: Record<string, number> = {};
    for (const row of sourceRows) bySource[row.source] = row.count;
    return {
      total: totals.total,
      positive: totals.positive,
      negative: totals.negative,
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
  confirmOrCreate(input: CreateRepoLearningInput): RepoLearningRow {
    const existing = this.db
      .prepare(
        `SELECT * FROM repo_learnings
          WHERE repo = ?
            AND LOWER(error_class) = LOWER(?)
            AND LOWER(root_cause) = LOWER(?)
          LIMIT 1`,
      )
      .get(input.repo, input.error_class, input.root_cause) as
      | RepoLearningRow
      | undefined;
    if (!existing) return this.create(input);

    const signal = input.rating ?? 0;
    const rating = existing.rating + Math.sign(signal - existing.rating);
    const fixApproach = existing.fix_approach ?? input.fix_approach ?? null;
    const updatedAt = input.created_at ?? Date.now();
    this.db
      .prepare(
        `UPDATE repo_learnings
            SET confirmations = confirmations + 1, rating = @rating,
                fix_approach = @fix_approach, updated_at = @updated_at
          WHERE id = @id`,
      )
      .run({
        id: existing.id,
        rating,
        fix_approach: fixApproach,
        updated_at: updatedAt,
      });
    return {
      ...existing,
      confirmations: existing.confirmations + 1,
      rating,
      fix_approach: fixApproach,
      updated_at: updatedAt,
    };
  }
}
