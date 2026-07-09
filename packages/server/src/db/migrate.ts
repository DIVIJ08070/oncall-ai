import type BetterSqlite3 from 'better-sqlite3';

/**
 * Idempotent schema migration for the OnCall AI platform DB (SPEC §8).
 *
 * Every statement is `CREATE ... IF NOT EXISTS`, so `migrate()` is safe to run
 * on every boot and on an already-migrated file. All 12 tables + their indexes
 * are created exactly per §8 (types, nullability, PK, UNIQUE, FK, indexes).
 *
 * Note the intentional cyclic FK: `incidents.pr_id → pull_requests.id` and
 * `pull_requests.incident_id → incidents.id`. SQLite allows a table to declare
 * an FK to a table that does not exist yet, and both columns are satisfiable at
 * insert time because `incidents.pr_id` is nullable (create incident → create
 * PR → back-fill `incidents.pr_id`).
 */

export const SCHEMA_VERSION = 1;

/** The 12 tables of the data model (SPEC §8), in creation order. */
export const TABLES = [
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
] as const;

export type TableName = (typeof TABLES)[number];

const DDL = /* sql */ `
-- ── customers (services/customers) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  ingest_api_key  TEXT NOT NULL UNIQUE,
  github_owner    TEXT,
  github_repo     TEXT,
  default_branch  TEXT NOT NULL DEFAULT 'main',
  created_at      INTEGER NOT NULL
);

-- ── users (OAuth, FR-15) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  github_user_id  INTEGER NOT NULL UNIQUE,
  github_login    TEXT NOT NULL,
  avatar_url      TEXT,
  access_token    TEXT,
  customer_id     TEXT REFERENCES customers(id),
  created_at      INTEGER NOT NULL
);

-- ── services (health + silence heartbeat) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id              TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL REFERENCES customers(id),
  name            TEXT NOT NULL,
  first_event_at  INTEGER,
  last_event_at   INTEGER,
  UNIQUE(customer_id, name)
);

-- ── log_events (FR-03) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS log_events (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  service          TEXT NOT NULL,
  timestamp        INTEGER NOT NULL,
  received_at      INTEGER NOT NULL,
  level            TEXT NOT NULL,
  message          TEXT NOT NULL,
  stack            TEXT,
  endpoint         TEXT,
  method           TEXT,
  status           INTEGER,
  latency_ms       INTEGER,
  fingerprint_sig  TEXT
);
CREATE INDEX IF NOT EXISTS idx_log_events_cust_svc_ts      ON log_events(customer_id, service, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_events_cust_lvl_ts      ON log_events(customer_id, level, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_events_cust_svc_lvl_ts  ON log_events(customer_id, service, level, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_events_cust_ts          ON log_events(customer_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_log_events_fingerprint      ON log_events(fingerprint_sig);

-- ── metric_samples (FR-04; written each detection tick) ─────────────────────
CREATE TABLE IF NOT EXISTS metric_samples (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    TEXT NOT NULL REFERENCES customers(id),
  service        TEXT NOT NULL,
  bucket_ts      INTEGER NOT NULL,
  window_sec     INTEGER NOT NULL,
  request_count  INTEGER NOT NULL,
  error_count    INTEGER NOT NULL,
  error_rate     REAL NOT NULL,
  p50_ms         INTEGER NOT NULL,
  p95_ms         INTEGER NOT NULL,
  p99_ms         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metric_samples_cust_svc_bucket ON metric_samples(customer_id, service, bucket_ts);

-- ── incidents (FR-05 dedup + lifecycle) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id                  TEXT PRIMARY KEY,
  customer_id         TEXT NOT NULL REFERENCES customers(id),
  service             TEXT NOT NULL,
  detector            TEXT NOT NULL,
  fingerprint         TEXT NOT NULL,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL,
  severity            TEXT NOT NULL,
  threshold_value     REAL NOT NULL,
  observed_value      REAL NOT NULL,
  first_error_at      INTEGER,
  detected_at         INTEGER NOT NULL,
  opened_at           INTEGER NOT NULL,
  root_cause          TEXT,
  confidence          REAL,
  pr_id               TEXT REFERENCES pull_requests(id),
  suspect_deploy_sha  TEXT,
  resolved_at         INTEGER,
  postmortem          TEXT,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incidents_cust_status ON incidents(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_dedup       ON incidents(customer_id, service, fingerprint, status);

-- ── investigation_sessions (FR-06/08) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS investigation_sessions (
  id             TEXT PRIMARY KEY,
  incident_id    TEXT NOT NULL REFERENCES incidents(id),
  status         TEXT NOT NULL,
  mode           TEXT NOT NULL,
  model          TEXT NOT NULL,
  started_at     INTEGER NOT NULL,
  completed_at   INTEGER,
  iterations     INTEGER NOT NULL,
  root_cause     TEXT,
  confidence     REAL,
  decision       TEXT,
  summary        TEXT,
  input_tokens   INTEGER NOT NULL,
  output_tokens  INTEGER NOT NULL,
  cost_usd       REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_incident ON investigation_sessions(incident_id);

-- ── investigation_steps (NFR-06 transparency + live feed) ───────────────────
CREATE TABLE IF NOT EXISTS investigation_steps (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES investigation_sessions(id),
  seq          INTEGER NOT NULL,
  type         TEXT NOT NULL,
  tool_name    TEXT,
  tool_input   TEXT,
  tool_output  TEXT,
  content      TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steps_session_seq ON investigation_steps(session_id, seq);

-- ── deploys (correlation + recovery) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deploys (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL REFERENCES customers(id),
  sha           TEXT NOT NULL,
  short_sha     TEXT NOT NULL,
  ref           TEXT NOT NULL,
  message       TEXT NOT NULL,
  author        TEXT NOT NULL,
  committed_at  INTEGER NOT NULL,
  deployed_at   INTEGER,
  is_current    INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL,
  pr_id         TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE(customer_id, sha)
);
CREATE INDEX IF NOT EXISTS idx_deploys_cust_current   ON deploys(customer_id, is_current);
CREATE INDEX IF NOT EXISTS idx_deploys_cust_committed ON deploys(customer_id, committed_at);

-- ── pull_requests (FR-09/10/12) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pull_requests (
  id                       TEXT PRIMARY KEY,
  incident_id              TEXT NOT NULL REFERENCES incidents(id),
  customer_id              TEXT NOT NULL REFERENCES customers(id),
  github_pr_number         INTEGER NOT NULL,
  github_pr_id             INTEGER NOT NULL,
  branch                   TEXT NOT NULL,
  base_branch              TEXT NOT NULL,
  title                    TEXT NOT NULL,
  url                      TEXT NOT NULL,
  kind                     TEXT NOT NULL,
  state                    TEXT NOT NULL,
  diagnostic_report        TEXT NOT NULL,
  head_sha                 TEXT NOT NULL,
  created_at               INTEGER NOT NULL,
  merged_at                INTEGER,
  verification_status      TEXT NOT NULL,
  verification_comment_id  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pull_requests_incident   ON pull_requests(incident_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_cust_state ON pull_requests(customer_id, state);

-- ── chat_messages (FR-16) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT REFERENCES incidents(id),
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  evidence     TEXT,
  created_at   INTEGER NOT NULL
);
-- id is a monotonic-ULID tiebreaker so same-millisecond rows return in
-- insertion order (BUG-006); it also fully covers the DAO ORDER BY.
CREATE INDEX IF NOT EXISTS idx_chat_messages_incident_created ON chat_messages(incident_id, created_at, id);

-- ── notifications (FR-17 stub) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT NOT NULL REFERENCES incidents(id),
  channel      TEXT NOT NULL,
  status       TEXT NOT NULL,
  payload      TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
`;

/**
 * Create every table + index if absent. Idempotent — running twice is a no-op.
 * Returns the schema version now recorded in `PRAGMA user_version`.
 */
export function migrate(db: BetterSqlite3.Database): number {
  // DDL runs in an implicit transaction via exec(); IF NOT EXISTS makes it safe.
  db.exec(DDL);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return SCHEMA_VERSION;
}

/** Read the schema version recorded on the file (0 if never migrated). */
export function schemaVersion(db: BetterSqlite3.Database): number {
  const rows = db.pragma('user_version') as Array<{ user_version: number }>;
  return rows[0]?.user_version ?? 0;
}

/** List existing user tables (for tests / diagnostics). */
export function existingTables(db: BetterSqlite3.Database): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}
