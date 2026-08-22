import type pg from 'pg';
import type { PrState, PullRequestRec } from '@oncall/shared';
import { newPullRequestId } from '../../ids.js';
import type {
  CreatePullRequestInput,
  PullRequestPatch,
  PullRequestsDao,
} from '../../dao/types.js';

/**
 * `pull_requests` DAO, postgres driver (FR-09/10/12). Same contract + row
 * shapes as the sqlite driver.
 */

const PATCHABLE_COLUMNS: (keyof PullRequestPatch)[] = [
  'state',
  'merged_at',
  'verification_status',
  'verification_comment_id',
  'head_sha',
  'url',
];

export class PgPullRequestsDao implements PullRequestsDao {
  constructor(private readonly pool: pg.Pool) {}

  async create(input: CreatePullRequestInput): Promise<PullRequestRec> {
    const row: PullRequestRec = {
      id: input.id ?? newPullRequestId(),
      incident_id: input.incident_id,
      customer_id: input.customer_id,
      github_pr_number: input.github_pr_number,
      github_pr_id: input.github_pr_id,
      branch: input.branch,
      base_branch: input.base_branch,
      title: input.title,
      url: input.url,
      kind: input.kind,
      state: input.state ?? 'open',
      diagnostic_report: input.diagnostic_report,
      head_sha: input.head_sha,
      created_at: input.created_at ?? Date.now(),
      merged_at: null,
      verification_status: input.verification_status ?? 'pending',
      verification_comment_id: null,
    };
    await this.pool.query(
      `INSERT INTO pull_requests
         (id, incident_id, customer_id, github_pr_number, github_pr_id, branch, base_branch,
          title, url, kind, state, diagnostic_report, head_sha, created_at, merged_at,
          verification_status, verification_comment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        row.id,
        row.incident_id,
        row.customer_id,
        row.github_pr_number,
        row.github_pr_id,
        row.branch,
        row.base_branch,
        row.title,
        row.url,
        row.kind,
        row.state,
        row.diagnostic_report,
        row.head_sha,
        row.created_at,
        row.merged_at,
        row.verification_status,
        row.verification_comment_id,
      ],
    );
    return row;
  }

  async getById(id: string): Promise<PullRequestRec | null> {
    const res = await this.pool.query<PullRequestRec>(
      `SELECT * FROM pull_requests WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async getByIncident(incidentId: string): Promise<PullRequestRec | null> {
    const res = await this.pool.query<PullRequestRec>(
      `SELECT * FROM pull_requests WHERE incident_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [incidentId],
    );
    return res.rows[0] ?? null;
  }

  /** PRs awaiting merge (merge poller scans these — §10.5). */
  async listByState(
    customerId: string,
    state: PrState,
  ): Promise<PullRequestRec[]> {
    const res = await this.pool.query<PullRequestRec>(
      `SELECT * FROM pull_requests WHERE customer_id = $1 AND state = $2
        ORDER BY created_at ASC`,
      [customerId, state],
    );
    return res.rows;
  }

  async update(
    id: string,
    patch: PullRequestPatch,
  ): Promise<PullRequestRec | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const col of PATCHABLE_COLUMNS) {
      if (col in patch && patch[col] !== undefined) {
        params.push(patch[col]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length === 0) return this.getById(id);
    const res = await this.pool.query<PullRequestRec>(
      `UPDATE pull_requests SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    return res.rows[0] ?? null;
  }
}
