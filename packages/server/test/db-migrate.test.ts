import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MEMORY_DB,
  openDatabase,
  openMemoryDatabase,
  SCHEMA_VERSION,
  TABLES,
  existingTables,
} from '../src/db/index.js';

/**
 * C2 self-verification — migrations (SPEC §8).
 * Proves: all 12 tables + indexes are created, WAL + foreign_keys are ON, and
 * `migrate()` is idempotent (safe to run repeatedly).
 */

const tmpDirs: string[] = [];
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oncall-c2-'));
  tmpDirs.push(dir);
  return join(dir, 'oncall.sqlite');
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('migrate() — schema (SPEC §8)', () => {
  it('creates all 12 tables', () => {
    const db = openMemoryDatabase();
    const tables = existingTables(db.raw);
    for (const t of TABLES) expect(tables).toContain(t);
    expect(TABLES).toHaveLength(12);
    db.close();
  });

  it('sets WAL journal mode and foreign_keys ON on a file DB', () => {
    const path = tempDbPath();
    const db = openDatabase(path);
    expect(existsSync(path)).toBe(true);
    const [{ journal_mode }] = db.raw.pragma('journal_mode') as Array<{
      journal_mode: string;
    }>;
    expect(String(journal_mode).toLowerCase()).toBe('wal');
    const [{ foreign_keys }] = db.raw.pragma('foreign_keys') as Array<{
      foreign_keys: number;
    }>;
    expect(foreign_keys).toBe(1);
    db.close();
  });

  it('records the schema version in user_version', () => {
    const db = openMemoryDatabase();
    expect(db.schemaVersion()).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('creates the §8 indexes (dedup, log, deploy, steps)', () => {
    const db = openMemoryDatabase();
    const indexes = (
      db.raw
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'`,
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    for (const expected of [
      'idx_log_events_cust_svc_ts',
      'idx_log_events_cust_lvl_ts',
      'idx_log_events_cust_svc_lvl_ts',
      'idx_log_events_cust_ts',
      'idx_log_events_fingerprint',
      'idx_metric_samples_cust_svc_bucket',
      'idx_incidents_cust_status',
      'idx_incidents_dedup',
      'idx_sessions_incident',
      'idx_steps_session_seq',
      'idx_deploys_cust_current',
      'idx_deploys_cust_committed',
      'idx_pull_requests_incident',
      'idx_pull_requests_cust_state',
      'idx_chat_messages_incident_created',
    ]) {
      expect(indexes).toContain(expected);
    }
    db.close();
  });

  it('enforces the declared UNIQUE constraints', () => {
    const db = openMemoryDatabase();
    const info = (name: string) =>
      db.raw.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(name) as
        | { sql: string }
        | undefined;
    expect(info('customers')?.sql).toMatch(/ingest_api_key.*UNIQUE/s);
    expect(info('users')?.sql).toMatch(/github_user_id.*UNIQUE/s);
    expect(info('services')?.sql).toMatch(/UNIQUE\(customer_id, name\)/);
    expect(info('deploys')?.sql).toMatch(/UNIQUE\(customer_id, sha\)/);
    db.close();
  });

  it('is idempotent across repeated migrate() calls', () => {
    const db = openMemoryDatabase();
    // A second and third migrate must not throw and must not duplicate tables.
    expect(() => db.migrate()).not.toThrow();
    expect(() => db.migrate()).not.toThrow();
    const tables = existingTables(db.raw).filter((t) => !t.startsWith('sqlite_'));
    expect(tables).toHaveLength(12);
    db.close();
  });

  it('is idempotent across process restarts on a file DB', () => {
    const path = tempDbPath();
    const first = openDatabase(path);
    // Seed a row so we can prove data survives re-migration.
    first.dao.customers.create({ name: 'acme', ingest_api_key: 'k-restart' });
    first.close();

    const second = openDatabase(path); // re-open + re-migrate
    expect(second.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(second.dao.customers.getByIngestKey('k-restart')?.name).toBe('acme');
    expect(existingTables(second.raw)).toHaveLength(12);
    second.close();
  });

  it('opens an in-memory DB without touching the filesystem', () => {
    const db = openDatabase(MEMORY_DB);
    expect(db.path).toBe(MEMORY_DB);
    expect(existingTables(db.raw)).toHaveLength(12);
    db.close();
  });
});
