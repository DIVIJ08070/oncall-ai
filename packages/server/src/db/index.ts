import type pg from 'pg';
import type { Daos } from './dao/types.js';
import { closePool, createPool } from './pg/pool.js';
import { migratePg, schemaVersionPg } from './pg/migrate.js';
import { createPgDaos } from './pg/index.js';

/**
 * Data layer entry point (SPEC §8 + DB report) — **PostgreSQL only**.
 *
 * `openDatabase()` creates the single shared `pg.Pool` (acquisition +
 * statement timeouts, created once, centrally here), runs the idempotent
 * migration, and wires up the 13 typed DAOs behind the shared **async** DAO
 * contract (`dao/types.ts`). `close()` drains the pool for graceful shutdown.
 */

export * from './ids.js';
export * from './rows.js';
export * from './dao/index.js';
export * from './pg/index.js';

export interface OpenDbOptions {
  /** Run migrations on open (default `true`). */
  migrate?: boolean;
  /** Max pooled clients (default 10). */
  poolMax?: number;
}

export interface OncallDb {
  /** The single shared pg connection pool. */
  pool: pg.Pool;
  /** The 13 typed DAOs (SPEC §8 + self-learning) — all methods async. */
  dao: Daos;
  /** The postgres connection URL (credentials included — do not log). */
  path: string;
  /** Re-run migrations (idempotent); resolves to the schema version. */
  migrate(): Promise<number>;
  /** Current recorded schema version. */
  schemaVersion(): Promise<number>;
  /** Drain the pool (graceful shutdown). */
  close(): Promise<void>;
}

function assertPostgresUrl(databaseUrl: string): void {
  if (
    !databaseUrl.startsWith('postgres://') &&
    !databaseUrl.startsWith('postgresql://')
  ) {
    throw new Error(
      `DATABASE_URL must be a postgres:// connection string (got "${databaseUrl.slice(0, 24)}…")`,
    );
  }
}

/**
 * Open (and by default migrate) the platform database.
 *
 * @param databaseUrl `postgres://user:pass@host:port/dbname` connection URL.
 */
export async function openDatabase(
  databaseUrl: string,
  opts: OpenDbOptions = {},
): Promise<OncallDb> {
  assertPostgresUrl(databaseUrl);
  const pool = createPool({
    connectionString: databaseUrl,
    max: opts.poolMax,
  });
  if (opts.migrate !== false) {
    await migratePg(pool);
  }
  return {
    pool,
    dao: createPgDaos(pool),
    path: databaseUrl,
    migrate: () => migratePg(pool),
    schemaVersion: () => schemaVersionPg(pool),
    close: () => closePool(pool),
  };
}
