import type pg from 'pg';
import type { Incident, IncidentStatus } from '@oncall/shared';
import { newIncidentId } from '../../ids.js';
import { TERMINAL_STATUSES } from '../../dao/types.js';
import type {
  IncidentPatch,
  IncidentsDao,
  IncidentsQuery,
  OpenIncidentInput,
  OpenResult,
} from '../../dao/types.js';
import { withTransaction, type Queryable } from '../pool.js';

/**
 * `incidents` DAO, postgres driver (SPEC §8, §10 lifecycle). Same
 * code-enforced dedup rule as the sqlite driver; `openOrDedup` runs its
 * find-or-insert atomically inside a `BEGIN`/`COMMIT` transaction on one
 * pooled client.
 */

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

export class PgIncidentsDao implements IncidentsDao {
  constructor(private readonly pool: pg.Pool) {}

  private async getByIdOn(q: Queryable, id: string): Promise<Incident | null> {
    const res = await q.query<Incident>(
      `SELECT * FROM incidents WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async getById(id: string): Promise<Incident | null> {
    return this.getByIdOn(this.pool, id);
  }

  private async findActiveOn(
    q: Queryable,
    customerId: string,
    service: string,
    fingerprint: string,
  ): Promise<Incident | null> {
    const placeholders = TERMINAL_STATUSES.map((_, i) => `$${i + 4}`).join(', ');
    const res = await q.query<Incident>(
      `SELECT * FROM incidents
        WHERE customer_id = $1 AND service = $2 AND fingerprint = $3
          AND status NOT IN (${placeholders})
        ORDER BY opened_at DESC LIMIT 1`,
      [customerId, service, fingerprint, ...TERMINAL_STATUSES],
    );
    return res.rows[0] ?? null;
  }

  /** The non-terminal incident (if any) matching the dedup key. */
  async findActiveByFingerprint(
    customerId: string,
    service: string,
    fingerprint: string,
  ): Promise<Incident | null> {
    return this.findActiveOn(this.pool, customerId, service, fingerprint);
  }

  /**
   * Code-enforced dedup (SPEC §8). Atomic: find-or-insert in one transaction.
   * On a live duplicate, only `observed_value`/`updated_at` advance.
   */
  async openOrDedup(input: OpenIncidentInput): Promise<OpenResult> {
    return withTransaction(this.pool, async (client): Promise<OpenResult> => {
      const active = await this.findActiveOn(
        client,
        input.customer_id,
        input.service,
        input.fingerprint,
      );
      if (active) {
        const now = Date.now();
        const res = await client.query<Incident>(
          `UPDATE incidents
              SET observed_value = $2, updated_at = $3
            WHERE id = $1
            RETURNING *`,
          [active.id, input.observed_value, now],
        );
        return { incident: res.rows[0]!, deduped: true };
      }
      const now = Date.now();
      const row: Incident = {
        id: newIncidentId(),
        customer_id: input.customer_id,
        service: input.service,
        detector: input.detector,
        fingerprint: input.fingerprint,
        title: input.title,
        status: input.status ?? 'open',
        severity: input.severity,
        threshold_value: input.threshold_value,
        observed_value: input.observed_value,
        first_error_at: input.first_error_at ?? null,
        detected_at: input.detected_at ?? now,
        opened_at: input.opened_at ?? now,
        root_cause: null,
        confidence: null,
        pr_id: null,
        suspect_deploy_sha: input.suspect_deploy_sha ?? null,
        resolved_at: null,
        postmortem: null,
        updated_at: now,
      };
      await client.query(
        `INSERT INTO incidents
           (id, customer_id, service, detector, fingerprint, title, status, severity,
            threshold_value, observed_value, first_error_at, detected_at, opened_at,
            root_cause, confidence, pr_id, suspect_deploy_sha, resolved_at, postmortem, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          row.id,
          row.customer_id,
          row.service,
          row.detector,
          row.fingerprint,
          row.title,
          row.status,
          row.severity,
          row.threshold_value,
          row.observed_value,
          row.first_error_at,
          row.detected_at,
          row.opened_at,
          row.root_cause,
          row.confidence,
          row.pr_id,
          row.suspect_deploy_sha,
          row.resolved_at,
          row.postmortem,
          row.updated_at,
        ],
      );
      return { incident: row, deduped: false };
    });
  }

  /** Patch arbitrary lifecycle fields; always bumps `updated_at`. */
  async update(id: string, patch: IncidentPatch): Promise<Incident | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const col of PATCHABLE_COLUMNS) {
      if (col in patch && patch[col] !== undefined) {
        params.push(patch[col]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    params.push(Date.now());
    sets.push(`updated_at = $${params.length}`);
    const res = await this.pool.query<Incident>(
      `UPDATE incidents SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    return res.rows[0] ?? null;
  }

  async setStatus(id: string, status: IncidentStatus): Promise<Incident | null> {
    return this.update(id, { status });
  }

  async list(q: IncidentsQuery = {}): Promise<Incident[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    if (q.customer_id !== undefined)
      where.push(`customer_id = ${bind(q.customer_id)}`);
    if (q.service !== undefined) where.push(`service = ${bind(q.service)}`);
    if (q.status !== undefined) where.push(`status = ${bind(q.status)}`);
    if (q.activeOnly) {
      const ph = TERMINAL_STATUSES.map((s) => bind(s)).join(', ');
      where.push(`status NOT IN (${ph})`);
    }
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const sql =
      `SELECT * FROM incidents` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY opened_at DESC LIMIT ${bind(limit)}`;
    const res = await this.pool.query<Incident>(sql, params);
    return res.rows;
  }
}
