/**
 * One-off data migration: legacy SQLite file → PostgreSQL (DB plan §9).
 *
 * Reads each table from the frozen SQLite file via the system `sqlite3` CLI
 * (JSON mode — the server no longer depends on better-sqlite3), loads rows
 * into PostgreSQL in dependency-safe order inside one transaction with FK
 * triggers deferred (`session_replication_role = replica`, safe here because
 * the source data already satisfied the same constraints), then verifies
 * row counts table-by-table.
 *
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts [path/to/oncall.sqlite]
 *
 * Idempotent: rows are inserted with ON CONFLICT DO NOTHING.
 *
 * NOTE: if the target server already booted once, it will have seeded its own
 * customer row; migrated rows keep the OLD customer id. After loading, re-point
 * them (UPDATE <table> SET customer_id = <new> WHERE customer_id = <old>) or
 * the customer-scoped APIs will not see the data.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import pg from 'pg';

const SQLITE_PATH = process.argv[2] ?? './data/oncall.sqlite';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/oncall';

/** Dependency-safe load order (parents before children). */
const TABLES = [
  'customers',
  'users',
  'services',
  'log_events',
  'metric_samples',
  'incidents',
  'investigation_sessions',
  'investigation_steps',
  'deploys',
  'pull_requests',
  'chat_messages',
  'notifications',
  'repo_learnings',
] as const;

function readSqliteTable(table: string): Record<string, unknown>[] {
  const out = execFileSync(
    'sqlite3',
    ['-json', SQLITE_PATH, `SELECT * FROM ${table};`],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  ).trim();
  return out ? (JSON.parse(out) as Record<string, unknown>[]) : [];
}

async function main(): Promise<void> {
  if (!existsSync(SQLITE_PATH)) {
    throw new Error(`SQLite source not found: ${SQLITE_PATH}`);
  }
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const client = await pool.connect();
  const migrated: Array<{ table: string; source: number; loaded: number }> = [];
  try {
    await client.query('BEGIN');
    await client.query(`SET session_replication_role = replica`);
    for (const table of TABLES) {
      const rows = readSqliteTable(table);
      let loaded = 0;
      for (const row of rows) {
        const cols = Object.keys(row);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const res = await client.query(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
           ON CONFLICT DO NOTHING`,
          cols.map((c) => row[c]),
        );
        loaded += res.rowCount ?? 0;
      }
      migrated.push({ table, source: rows.length, loaded });
    }
    await client.query(`SET session_replication_role = DEFAULT`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // verification: pg row counts vs source
  console.log('\ntable                     source  loaded  pg-total');
  for (const { table, source, loaded } of migrated) {
    const res = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    const total = (res.rows[0] as { n: number }).n;
    const flag = total >= source ? 'ok' : 'MISMATCH';
    console.log(
      `${table.padEnd(25)} ${String(source).padStart(6)} ${String(loaded).padStart(7)} ${String(total).padStart(9)}  ${flag}`,
    );
  }
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
