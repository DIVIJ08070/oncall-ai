import type BetterSqlite3 from 'better-sqlite3';
import type {
  Detector,
  Incident,
  IncidentStatus,
  Severity,
} from '@oncall/shared';
import { newIncidentId } from '../ids.js';

/**
 * `incidents` DAO (SPEC §8, §10 lifecycle). Home of the **code-enforced dedup
 * rule** (§8): before opening, if an incident with the same
 * `(customer_id, service, fingerprint)` exists in a **non-terminal** status,
 * update `observed_value`/`updated_at` instead of inserting a duplicate.
 *
 * Terminal statuses for dedup = `resolved` and `closed`. `escalated` is
 * "terminal until human" (§10.4) but the underlying problem is still live, so
 * it is treated as non-terminal here — a fresh breach of the same fingerprint
 * updates the escalated incident rather than spawning a duplicate.
 */

/** Statuses at which an incident no longer dedups new breaches (SPEC §8/§10.4). */
export const TERMINAL_STATUSES: readonly IncidentStatus[] = ['resolved', 'closed'];

export function isTerminalStatus(status: IncidentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface OpenIncidentInput {
  customer_id: string;
  service: string;
  detector: Detector;
  fingerprint: string;
  title: string;
  severity: Severity;
  threshold_value: number;
  observed_value: number;
  status?: IncidentStatus;
  first_error_at?: number | null;
  detected_at?: number;
  opened_at?: number;
  suspect_deploy_sha?: string | null;
}

export interface OpenResult {
  incident: Incident;
  /** `true` when an existing non-terminal incident was updated (deduped). */
  deduped: boolean;
}

/** Fields the lifecycle / agent / recovery flows patch onto an incident. */
export type IncidentPatch = Partial<
  Pick<
    Incident,
    | 'status'
    | 'severity'
    | 'observed_value'
    | 'threshold_value'
    | 'root_cause'
    | 'confidence'
    | 'pr_id'
    | 'suspect_deploy_sha'
    | 'first_error_at'
    | 'resolved_at'
    | 'postmortem'
  >
>;

export interface IncidentsQuery {
  customer_id?: string;
  service?: string;
  status?: IncidentStatus;
  /** Only incidents in a non-terminal status. */
  activeOnly?: boolean;
  limit?: number;
}

const PATCHABLE_COLUMNS: (keyof IncidentPatch)[] = [
  'status',
  'severity',
  'observed_value',
  'threshold_value',
  'root_cause',
  'confidence',
  'pr_id',
  'suspect_deploy_sha',
  'first_error_at',
  'resolved_at',
  'postmortem',
];

export class IncidentsDao {
  constructor(private readonly db: BetterSqlite3.Database) {}

  getById(id: string): Incident | null {
    return (
      (this.db
        .prepare(`SELECT * FROM incidents WHERE id = ?`)
        .get(id) as Incident | undefined) ?? null
    );
  }

  /** The non-terminal incident (if any) matching the dedup key. */
  findActiveByFingerprint(
    customerId: string,
    service: string,
    fingerprint: string,
  ): Incident | null {
    const placeholders = TERMINAL_STATUSES.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT * FROM incidents
          WHERE customer_id = ? AND service = ? AND fingerprint = ?
            AND status NOT IN (${placeholders})
          ORDER BY opened_at DESC LIMIT 1`,
      )
      .get(customerId, service, fingerprint, ...TERMINAL_STATUSES) as
      | Incident
      | undefined;
    return row ?? null;
  }

  /**
   * Code-enforced dedup (SPEC §8). Atomic: find-or-insert in one transaction.
   * On a live duplicate, only `observed_value`/`updated_at` advance.
   */
  openOrDedup(input: OpenIncidentInput): OpenResult {
    const tx = this.db.transaction((data: OpenIncidentInput): OpenResult => {
      const active = this.findActiveByFingerprint(
        data.customer_id,
        data.service,
        data.fingerprint,
      );
      if (active) {
        const now = Date.now();
        this.db
          .prepare(
            `UPDATE incidents
                SET observed_value = @observed_value, updated_at = @updated_at
              WHERE id = @id`,
          )
          .run({ id: active.id, observed_value: data.observed_value, updated_at: now });
        return { incident: this.getById(active.id)!, deduped: true };
      }
      const now = Date.now();
      const row: Incident = {
        id: newIncidentId(),
        customer_id: data.customer_id,
        service: data.service,
        detector: data.detector,
        fingerprint: data.fingerprint,
        title: data.title,
        status: data.status ?? 'open',
        severity: data.severity,
        threshold_value: data.threshold_value,
        observed_value: data.observed_value,
        first_error_at: data.first_error_at ?? null,
        detected_at: data.detected_at ?? now,
        opened_at: data.opened_at ?? now,
        root_cause: null,
        confidence: null,
        pr_id: null,
        suspect_deploy_sha: data.suspect_deploy_sha ?? null,
        resolved_at: null,
        postmortem: null,
        updated_at: now,
      };
      this.db
        .prepare(
          `INSERT INTO incidents
             (id, customer_id, service, detector, fingerprint, title, status, severity,
              threshold_value, observed_value, first_error_at, detected_at, opened_at,
              root_cause, confidence, pr_id, suspect_deploy_sha, resolved_at, postmortem, updated_at)
           VALUES
             (@id, @customer_id, @service, @detector, @fingerprint, @title, @status, @severity,
              @threshold_value, @observed_value, @first_error_at, @detected_at, @opened_at,
              @root_cause, @confidence, @pr_id, @suspect_deploy_sha, @resolved_at, @postmortem, @updated_at)`,
        )
        .run(row);
      return { incident: row, deduped: false };
    });
    return tx(input);
  }

  /** Patch arbitrary lifecycle fields; always bumps `updated_at`. */
  update(id: string, patch: IncidentPatch): Incident | null {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id, updated_at: Date.now() };
    for (const col of PATCHABLE_COLUMNS) {
      if (col in patch && patch[col] !== undefined) {
        sets.push(`${col} = @${col}`);
        params[col] = patch[col];
      }
    }
    sets.push('updated_at = @updated_at');
    this.db
      .prepare(`UPDATE incidents SET ${sets.join(', ')} WHERE id = @id`)
      .run(params);
    return this.getById(id);
  }

  setStatus(id: string, status: IncidentStatus): Incident | null {
    return this.update(id, { status });
  }

  list(q: IncidentsQuery = {}): Incident[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (q.customer_id !== undefined) {
      where.push('customer_id = @customer_id');
      params.customer_id = q.customer_id;
    }
    if (q.service !== undefined) {
      where.push('service = @service');
      params.service = q.service;
    }
    if (q.status !== undefined) {
      where.push('status = @status');
      params.status = q.status;
    }
    if (q.activeOnly) {
      const ph = TERMINAL_STATUSES.map((_, i) => `@term${i}`).join(', ');
      where.push(`status NOT IN (${ph})`);
      TERMINAL_STATUSES.forEach((s, i) => (params[`term${i}`] = s));
    }
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    params.limit = limit;
    const sql =
      `SELECT * FROM incidents` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY opened_at DESC LIMIT @limit`;
    return this.db.prepare(sql).all(params) as Incident[];
  }
}
