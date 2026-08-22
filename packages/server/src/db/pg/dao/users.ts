import type pg from 'pg';
import { newUserId } from '../../ids.js';
import type { UserRow } from '../../rows.js';
import type { UpsertUserInput, UsersDao } from '../../dao/types.js';

/**
 * `users` DAO, postgres driver (FR-15). Same contract + row shapes as the
 * sqlite driver; the upsert preserves an existing `access_token`/`customer_id`
 * when the new input omits them (login-callback semantics).
 */
export class PgUsersDao implements UsersDao {
  constructor(private readonly pool: pg.Pool) {}

  async getById(id: string): Promise<UserRow | null> {
    const res = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async getByGithubUserId(githubUserId: number): Promise<UserRow | null> {
    const res = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE github_user_id = $1`,
      [githubUserId],
    );
    return res.rows[0] ?? null;
  }

  /** Insert on first sign-in, else refresh login/avatar/token in place. */
  async upsertByGithubUserId(input: UpsertUserInput): Promise<UserRow> {
    const existing = await this.getByGithubUserId(input.github_user_id);
    if (existing) {
      const res = await this.pool.query<UserRow>(
        `UPDATE users
            SET github_login = $2, avatar_url = $3, access_token = $4, customer_id = $5
          WHERE github_user_id = $1
          RETURNING *`,
        [
          input.github_user_id,
          input.github_login,
          input.avatar_url ?? null,
          input.access_token ?? existing.access_token ?? null,
          input.customer_id ?? existing.customer_id ?? null,
        ],
      );
      return res.rows[0]!;
    }
    const row: UserRow = {
      id: newUserId(),
      github_user_id: input.github_user_id,
      github_login: input.github_login,
      avatar_url: input.avatar_url ?? null,
      access_token: input.access_token ?? null,
      customer_id: input.customer_id ?? null,
      created_at: Date.now(),
    };
    await this.pool.query(
      `INSERT INTO users
         (id, github_user_id, github_login, avatar_url, access_token, customer_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.id,
        row.github_user_id,
        row.github_login,
        row.avatar_url,
        row.access_token,
        row.customer_id,
        row.created_at,
      ],
    );
    return row;
  }
}
