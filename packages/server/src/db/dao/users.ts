import type BetterSqlite3 from 'better-sqlite3';
import { newUserId } from '../ids.js';
import type { UserRow } from '../rows.js';

/**
 * `users` DAO (SPEC §8, FR-15). GitHub OAuth identities; `github_user_id` is
 * UNIQUE. `upsertByGithubUserId` is the login-callback path (insert or refresh
 * login/avatar/token). `access_token` is plaintext in MVP (OQ-1).
 */

export interface UpsertUserInput {
  github_user_id: number;
  github_login: string;
  avatar_url?: string | null;
  access_token?: string | null;
  customer_id?: string | null;
}

export class UsersDao {
  constructor(private readonly db: BetterSqlite3.Database) {}

  getById(id: string): UserRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM users WHERE id = ?`)
        .get(id) as UserRow | undefined) ?? null
    );
  }

  getByGithubUserId(githubUserId: number): UserRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM users WHERE github_user_id = ?`)
        .get(githubUserId) as UserRow | undefined) ?? null
    );
  }

  /** Insert on first sign-in, else refresh login/avatar/token in place. */
  upsertByGithubUserId(input: UpsertUserInput): UserRow {
    const existing = this.getByGithubUserId(input.github_user_id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE users
              SET github_login = @github_login,
                  avatar_url   = @avatar_url,
                  access_token = @access_token,
                  customer_id  = @customer_id
            WHERE github_user_id = @github_user_id`,
        )
        .run({
          github_user_id: input.github_user_id,
          github_login: input.github_login,
          avatar_url: input.avatar_url ?? null,
          access_token: input.access_token ?? existing.access_token ?? null,
          customer_id: input.customer_id ?? existing.customer_id ?? null,
        });
      return this.getByGithubUserId(input.github_user_id)!;
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
    this.db
      .prepare(
        `INSERT INTO users
           (id, github_user_id, github_login, avatar_url, access_token, customer_id, created_at)
         VALUES
           (@id, @github_user_id, @github_login, @avatar_url, @access_token, @customer_id, @created_at)`,
      )
      .run(row);
    return row;
  }
}
