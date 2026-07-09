import type BetterSqlite3 from 'better-sqlite3';
import type {
  PrKind,
  PrState,
  PullRequestRec,
  VerificationStatus,
} from '@oncall/shared';
import { newPullRequestId } from '../ids.js';

/**
 * `pull_requests` DAO (SPEC §8, FR-09/10/12). One row per PR the agent opens.
 * `state`/`verification_status` are advanced by the merge poller + recovery
 * verifier (§10.5).
 */

export interface CreatePullRequestInput {
  incident_id: string;
  customer_id: string;
  github_pr_number: number;
  github_pr_id: number;
  branch: string;
  base_branch: string;
  title: string;
  url: string;
  kind: PrKind;
  diagnostic_report: string;
  head_sha: string;
  state?: PrState;
  verification_status?: VerificationStatus;
  created_at?: number;
  id?: string;
}

export type PullRequestPatch = Partial<
  Pick<
    PullRequestRec,
    | 'state'
    | 'merged_at'
    | 'verification_status'
    | 'verification_comment_id'
    | 'head_sha'
    | 'url'
  >
>;

const PATCHABLE_COLUMNS: (keyof PullRequestPatch)[] = [
  'state',
  'merged_at',
  'verification_status',
  'verification_comment_id',
  'head_sha',
  'url',
];

export class PullRequestsDao {
  constructor(private readonly db: BetterSqlite3.Database) {}

  create(input: CreatePullRequestInput): PullRequestRec {
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
    this.db
      .prepare(
        `INSERT INTO pull_requests
           (id, incident_id, customer_id, github_pr_number, github_pr_id, branch, base_branch,
            title, url, kind, state, diagnostic_report, head_sha, created_at, merged_at,
            verification_status, verification_comment_id)
         VALUES
           (@id, @incident_id, @customer_id, @github_pr_number, @github_pr_id, @branch, @base_branch,
            @title, @url, @kind, @state, @diagnostic_report, @head_sha, @created_at, @merged_at,
            @verification_status, @verification_comment_id)`,
      )
      .run(row);
    return row;
  }

  getById(id: string): PullRequestRec | null {
    return (
      (this.db
        .prepare(`SELECT * FROM pull_requests WHERE id = ?`)
        .get(id) as PullRequestRec | undefined) ?? null
    );
  }

  getByIncident(incidentId: string): PullRequestRec | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM pull_requests WHERE incident_id = ?
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get(incidentId) as PullRequestRec | undefined) ?? null
    );
  }

  /** PRs awaiting merge (merge poller scans these — §10.5). */
  listByState(customerId: string, state: PrState): PullRequestRec[] {
    return this.db
      .prepare(
        `SELECT * FROM pull_requests WHERE customer_id = ? AND state = ?
          ORDER BY created_at ASC`,
      )
      .all(customerId, state) as PullRequestRec[];
  }

  update(id: string, patch: PullRequestPatch): PullRequestRec | null {
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
      .prepare(`UPDATE pull_requests SET ${sets.join(', ')} WHERE id = @id`)
      .run(params);
    return this.getById(id);
  }
}
