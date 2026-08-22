import type pg from 'pg';
import { newCustomerId } from '../../ids.js';
import type { CustomerRow } from '../../rows.js';
import type { CreateCustomerInput, CustomersDao } from '../../dao/types.js';

/**
 * `customers` DAO, postgres driver. Same contract + row shapes as the sqlite
 * driver (`dao/types.ts`); parameterized `$n` SQL throughout.
 */
export class PgCustomersDao implements CustomersDao {
  constructor(private readonly pool: pg.Pool) {}

  async create(input: CreateCustomerInput): Promise<CustomerRow> {
    const row: CustomerRow = {
      id: input.id ?? newCustomerId(),
      name: input.name,
      ingest_api_key: input.ingest_api_key,
      github_owner: input.github_owner ?? null,
      github_repo: input.github_repo ?? null,
      default_branch: input.default_branch ?? 'main',
      created_at: input.created_at ?? Date.now(),
    };
    await this.pool.query(
      `INSERT INTO customers
         (id, name, ingest_api_key, github_owner, github_repo, default_branch, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.id,
        row.name,
        row.ingest_api_key,
        row.github_owner,
        row.github_repo,
        row.default_branch,
        row.created_at,
      ],
    );
    return row;
  }

  async getById(id: string): Promise<CustomerRow | null> {
    const res = await this.pool.query<CustomerRow>(
      `SELECT * FROM customers WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async getByIngestKey(key: string): Promise<CustomerRow | null> {
    const res = await this.pool.query<CustomerRow>(
      `SELECT * FROM customers WHERE ingest_api_key = $1`,
      [key],
    );
    return res.rows[0] ?? null;
  }

  async list(): Promise<CustomerRow[]> {
    const res = await this.pool.query<CustomerRow>(
      `SELECT * FROM customers ORDER BY created_at ASC`,
    );
    return res.rows;
  }

  /** Bind a customer to a selected GitHub repo (SPEC §7.5 repo select). */
  async setRepo(
    id: string,
    owner: string,
    repo: string,
    defaultBranch: string,
  ): Promise<CustomerRow | null> {
    const res = await this.pool.query<CustomerRow>(
      `UPDATE customers
          SET github_owner = $2, github_repo = $3, default_branch = $4
        WHERE id = $1
        RETURNING *`,
      [id, owner, repo, defaultBranch],
    );
    return res.rows[0] ?? null;
  }
}
