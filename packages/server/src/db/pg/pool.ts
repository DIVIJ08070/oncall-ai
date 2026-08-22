import pg from 'pg';

/**
 * PostgreSQL connection pool (dual-driver layer, DB_DRIVER=postgres).
 *
 * One `pg.Pool` is created **once, centrally** by `openDatabase()` and shared
 * by every DAO — nothing else in the codebase constructs pools or clients.
 * Timeouts guard both sides of the pool:
 *
 *  - `connectionTimeoutMillis` — max wait to **acquire** a client from the
 *    pool (or open a fresh TCP connection) before erroring.
 *  - `statement_timeout` — server-side cap on any single statement.
 *  - `query_timeout` — client-side safety net slightly above the server cap.
 *
 * Graceful shutdown goes through `closePool()` (`pool.end()` drains clients).
 */

/**
 * All sqlite `INTEGER` columns are declared `BIGINT` in the postgres schema
 * (ms-epoch timestamps exceed int4). node-postgres returns int8 as *strings*
 * by default; every stored value here is far below `Number.MAX_SAFE_INTEGER`
 * (2^53), so parse them to JS numbers to keep row shapes identical across
 * drivers. Registered once, module-level (type parsers are global to `pg`).
 */
const INT8_OID = 20;
pg.types.setTypeParser(INT8_OID, (value: string) => Number(value));

export interface PgPoolOptions {
  /** `postgres://user:pass@host:port/dbname` connection string. */
  connectionString: string;
  /** Max pooled clients (default 10). */
  max?: number;
  /** Client acquisition timeout in ms (default 10 000). */
  acquireTimeoutMs?: number;
  /** Per-statement server-side timeout in ms (default 30 000). */
  statementTimeoutMs?: number;
  /** Idle client eviction in ms (default 30 000). */
  idleTimeoutMs?: number;
}

/** Create the single shared pool. Called once by `openDatabase()`. */
export function createPool(opts: PgPoolOptions): pg.Pool {
  const statementTimeout = opts.statementTimeoutMs ?? 30_000;
  return new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    connectionTimeoutMillis: opts.acquireTimeoutMs ?? 10_000,
    idleTimeoutMillis: opts.idleTimeoutMs ?? 30_000,
    statement_timeout: statementTimeout,
    // Client-side net: fires if the server-side cap somehow never does.
    query_timeout: statementTimeout + 5_000,
  });
}

/** Drain and close the pool (graceful shutdown). Safe to call once. */
export async function closePool(pool: pg.Pool): Promise<void> {
  await pool.end();
}

/**
 * Run `fn` on one client inside a `BEGIN`/`COMMIT` transaction, rolling back
 * on error. The pg counterpart of `better-sqlite3`'s `db.transaction()`.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Connection-level failure — rollback is implicit when the session dies.
    }
    throw err;
  } finally {
    client.release();
  }
}

/** A query runner: either the pool itself or a checked-out client. */
export type Queryable = pg.Pool | pg.PoolClient;
