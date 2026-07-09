import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { migrate, schemaVersion } from './migrate.js';
import { createDaos, type Daos } from './dao/index.js';

/**
 * SQLite data layer entry point (SPEC §8). `openDatabase()` opens a
 * better-sqlite3 connection in **WAL** mode with **foreign keys ON**, ensures
 * the parent directory exists, runs the idempotent migration, and wires up the
 * 12 typed DAOs.
 */

export * from './ids.js';
export * from './rows.js';
export * from './migrate.js';
export * from './dao/index.js';

/** In-memory database path (tests). */
export const MEMORY_DB = ':memory:';

export interface OpenDbOptions {
  /** Run migrations on open (default `true`). */
  migrate?: boolean;
  /** Open read-only (default `false`). */
  readonly?: boolean;
  /** Forward better-sqlite3 verbose logger (tests / debugging). */
  verbose?: (message?: unknown, ...args: unknown[]) => void;
}

export interface OncallDb {
  /** The underlying better-sqlite3 connection. */
  raw: Database.Database;
  /** The 12 typed DAOs (SPEC §8). */
  dao: Daos;
  /** The resolved path (or `:memory:`). */
  path: string;
  /** Re-run migrations (idempotent); returns the schema version. */
  migrate(): number;
  /** Current on-file schema version. */
  schemaVersion(): number;
  /** Close the connection. */
  close(): void;
}

function normalizePath(databaseUrl: string): string {
  if (databaseUrl === MEMORY_DB) return MEMORY_DB;
  // Tolerate a `file:` prefix from URL-style config, else use as-is.
  return databaseUrl.startsWith('file:')
    ? databaseUrl.slice('file:'.length)
    : databaseUrl;
}

/**
 * Open (and by default migrate) the platform database.
 *
 * @param databaseUrl filesystem path, or `:memory:` for tests.
 */
export function openDatabase(
  databaseUrl: string,
  opts: OpenDbOptions = {},
): OncallDb {
  const path = normalizePath(databaseUrl);

  if (path !== MEMORY_DB) {
    // Ensure the data/ directory exists before better-sqlite3 opens the file.
    mkdirSync(dirname(path), { recursive: true });
  }

  const raw = new Database(path, {
    readonly: opts.readonly ?? false,
    verbose: opts.verbose,
  });

  // Pragmas (SPEC §8: WAL + foreign keys ON). synchronous=NORMAL + busy_timeout
  // are the standard WAL companions for a single-writer local app.
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('synchronous = NORMAL');
  raw.pragma('busy_timeout = 5000');

  const db: OncallDb = {
    raw,
    dao: createDaos(raw),
    path,
    migrate: () => migrate(raw),
    schemaVersion: () => schemaVersion(raw),
    close: () => raw.close(),
  };

  if (opts.migrate ?? true) db.migrate();
  return db;
}

/** Open a fresh in-memory database (migrated). Convenience for tests. */
export function openMemoryDatabase(opts: OpenDbOptions = {}): OncallDb {
  return openDatabase(MEMORY_DB, opts);
}
