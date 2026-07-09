import type BetterSqlite3 from 'better-sqlite3';
import { newCustomerId } from '../ids.js';
import type { CustomerRow } from '../rows.js';

/**
 * `customers` DAO (SPEC §8). One row per onboarded customer; `ingest_api_key`
 * is UNIQUE and is the credential `POST /ingest` authenticates against (FR-01).
 */

export interface CreateCustomerInput {
  name: string;
  ingest_api_key: string;
  github_owner?: string | null;
  github_repo?: string | null;
  default_branch?: string;
  id?: string;
  created_at?: number;
}

export class CustomersDao {
  constructor(private readonly db: BetterSqlite3.Database) {}

  create(input: CreateCustomerInput): CustomerRow {
    const row: CustomerRow = {
      id: input.id ?? newCustomerId(),
      name: input.name,
      ingest_api_key: input.ingest_api_key,
      github_owner: input.github_owner ?? null,
      github_repo: input.github_repo ?? null,
      default_branch: input.default_branch ?? 'main',
      created_at: input.created_at ?? Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO customers
           (id, name, ingest_api_key, github_owner, github_repo, default_branch, created_at)
         VALUES
           (@id, @name, @ingest_api_key, @github_owner, @github_repo, @default_branch, @created_at)`,
      )
      .run(row);
    return row;
  }

  getById(id: string): CustomerRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM customers WHERE id = ?`)
        .get(id) as CustomerRow | undefined) ?? null
    );
  }

  getByIngestKey(key: string): CustomerRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM customers WHERE ingest_api_key = ?`)
        .get(key) as CustomerRow | undefined) ?? null
    );
  }

  list(): CustomerRow[] {
    return this.db
      .prepare(`SELECT * FROM customers ORDER BY created_at ASC`)
      .all() as CustomerRow[];
  }

  /** Bind a customer to a selected GitHub repo (SPEC §7.5 repo select). */
  setRepo(
    id: string,
    owner: string,
    repo: string,
    defaultBranch: string,
  ): CustomerRow | null {
    this.db
      .prepare(
        `UPDATE customers
            SET github_owner = @owner, github_repo = @repo, default_branch = @defaultBranch
          WHERE id = @id`,
      )
      .run({ id, owner, repo, defaultBranch });
    return this.getById(id);
  }
}
