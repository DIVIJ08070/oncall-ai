import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openDatabase,
  openMemoryDatabase,
  type OncallDb,
  TABLES,
  existingTables,
  hasPrefix,
  ID_PREFIX,
  STACK_MAX_BYTES,
  truncateStack,
  boolToInt,
  intToBool,
  toJson,
  fromJson,
  TERMINAL_STATUSES,
  isTerminalStatus,
} from '../src/db/index.js';

/**
 * QA C2 — independent contract suite derived from SPEC §8 BEFORE reading impl.
 * See features/oncall-ai/qa/TEST_CASES-C2.md (TC-01 … TC-44). Judges the spec
 * contract, not the implementation. Never mutates app code.
 */

let db: OncallDb;
beforeEach(() => {
  db = openMemoryDatabase();
});
afterEach(() => {
  db.close();
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

function seedCustomer(key = 'k-' + Math.random().toString(36).slice(2)): string {
  return db.dao.customers.create({ name: 'acme', ingest_api_key: key }).id;
}

/** All column-name tuples covered by any index on `table` (via PRAGMA). */
function indexTuples(d: OncallDb, table: string): string[][] {
  const idxs = d.raw.pragma(`index_list(${table})`) as Array<{ name: string }>;
  return idxs.map((ix) => {
    const cols = d.raw.pragma(`index_info(${ix.name})`) as Array<{
      seqno: number;
      name: string;
    }>;
    return cols.sort((a, b) => a.seqno - b.seqno).map((c) => c.name);
  });
}

function hasIndexOn(d: OncallDb, table: string, cols: string[]): boolean {
  return indexTuples(d, table).some(
    (t) => t.length >= cols.length && cols.every((c, i) => t[i] === c),
  );
}

function columnInfo(d: OncallDb, table: string): Record<string, { type: string; pk: number; notnull: number }> {
  const rows = d.raw.pragma(`table_info(${table})`) as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;
  const out: Record<string, { type: string; pk: number; notnull: number }> = {};
  for (const r of rows) out[r.name] = { type: r.type, pk: r.pk, notnull: r.notnull };
  return out;
}

/* ══ A. Migration / schema structure ═════════════════════════════════════ */

describe('A. migration & schema (§8)', () => {
  it('TC-01 creates exactly the 12 §8 tables', () => {
    const expected = [
      'customers', 'users', 'services', 'log_events', 'metric_samples',
      'incidents', 'investigation_sessions', 'investigation_steps', 'deploys',
      'pull_requests', 'chat_messages', 'notifications',
    ].sort();
    expect(existingTables(db.raw).sort()).toEqual(expected);
    expect([...TABLES].sort()).toEqual(expected);
  });

  it('TC-02 WAL mode on a file-backed DB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oncall-wal-'));
    const fdb = openDatabase(join(dir, 'a.sqlite'));
    try {
      const mode = (fdb.raw.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode;
      expect(mode).toBe('wal');
    } finally {
      fdb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('TC-03 foreign_keys ON', () => {
    const fk = (db.raw.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0].foreign_keys;
    expect(fk).toBe(1);
  });

  it('TC-04 migrate() is idempotent on one connection', () => {
    expect(() => { db.migrate(); db.migrate(); }).not.toThrow();
    expect(existingTables(db.raw)).toHaveLength(12);
    expect(db.schemaVersion()).toBe(1);
  });

  it('TC-05 idempotent across reopen; data survives', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oncall-reopen-'));
    const path = join(dir, 'b.sqlite');
    try {
      const d1 = openDatabase(path);
      const cid = d1.dao.customers.create({ name: 'x', ingest_api_key: 'reopen-key' }).id;
      d1.close();

      const d2 = openDatabase(path); // migrate() runs again on reopen
      expect(() => d2.migrate()).not.toThrow();
      expect(existingTables(d2.raw)).toHaveLength(12);
      const survived = d2.dao.customers.getById(cid);
      expect(survived?.ingest_api_key).toBe('reopen-key');
      d2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('TC-06 every §8 index is present (by column tuple)', () => {
    const required: Array<[string, string[]]> = [
      ['log_events', ['customer_id', 'service', 'timestamp']],
      ['log_events', ['customer_id', 'level', 'timestamp']],
      ['log_events', ['customer_id', 'service', 'level', 'timestamp']],
      ['log_events', ['customer_id', 'timestamp']],
      ['log_events', ['fingerprint_sig']],
      ['metric_samples', ['customer_id', 'service', 'bucket_ts']],
      ['incidents', ['customer_id', 'status']],
      ['incidents', ['customer_id', 'service', 'fingerprint', 'status']],
      ['investigation_sessions', ['incident_id']],
      ['investigation_steps', ['session_id', 'seq']],
      ['deploys', ['customer_id', 'is_current']],
      ['deploys', ['customer_id', 'committed_at']],
      ['pull_requests', ['incident_id']],
      ['pull_requests', ['customer_id', 'state']],
      ['chat_messages', ['incident_id', 'created_at']],
    ];
    for (const [table, cols] of required) {
      expect(hasIndexOn(db, table, cols), `missing index ${table}(${cols.join(',')})`).toBe(true);
    }
  });

  it('TC-07 columns & key types per §8', () => {
    const cols = (t: string) => Object.keys(columnInfo(db, t)).sort();
    expect(cols('customers')).toEqual(
      ['created_at', 'default_branch', 'github_owner', 'github_repo', 'id', 'ingest_api_key', 'name'],
    );
    expect(cols('users')).toEqual(
      ['access_token', 'avatar_url', 'created_at', 'customer_id', 'github_login', 'github_user_id', 'id'],
    );
    expect(cols('services')).toEqual(
      ['customer_id', 'first_event_at', 'id', 'last_event_at', 'name'],
    );
    expect(cols('log_events')).toEqual(
      ['customer_id', 'endpoint', 'fingerprint_sig', 'id', 'latency_ms', 'level', 'message', 'method', 'received_at', 'service', 'stack', 'status', 'timestamp'],
    );
    expect(cols('metric_samples')).toEqual(
      ['bucket_ts', 'customer_id', 'error_count', 'error_rate', 'id', 'p50_ms', 'p95_ms', 'p99_ms', 'request_count', 'service', 'window_sec'],
    );
    expect(cols('incidents')).toEqual(
      ['confidence', 'customer_id', 'detected_at', 'detector', 'fingerprint', 'first_error_at', 'id', 'observed_value', 'opened_at', 'postmortem', 'pr_id', 'resolved_at', 'root_cause', 'service', 'severity', 'status', 'suspect_deploy_sha', 'threshold_value', 'title', 'updated_at'],
    );
    expect(cols('investigation_sessions')).toEqual(
      ['completed_at', 'confidence', 'cost_usd', 'decision', 'id', 'incident_id', 'input_tokens', 'iterations', 'mode', 'model', 'output_tokens', 'root_cause', 'started_at', 'status', 'summary'],
    );
    expect(cols('investigation_steps')).toEqual(
      ['content', 'created_at', 'id', 'seq', 'session_id', 'tool_input', 'tool_name', 'tool_output', 'type'],
    );
    expect(cols('deploys')).toEqual(
      ['author', 'committed_at', 'created_at', 'customer_id', 'deployed_at', 'id', 'is_current', 'message', 'pr_id', 'ref', 'sha', 'short_sha', 'source'],
    );
    expect(cols('pull_requests')).toEqual(
      ['base_branch', 'branch', 'created_at', 'customer_id', 'diagnostic_report', 'github_pr_id', 'github_pr_number', 'head_sha', 'id', 'incident_id', 'kind', 'merged_at', 'state', 'title', 'url', 'verification_comment_id', 'verification_status'],
    );
    expect(cols('chat_messages')).toEqual(
      ['content', 'created_at', 'evidence', 'id', 'incident_id', 'role'],
    );
    expect(cols('notifications')).toEqual(
      ['channel', 'created_at', 'id', 'incident_id', 'payload', 'status'],
    );

    // metric_samples.id = INTEGER PK (the only autoincrement table); others TEXT PK.
    const ms = columnInfo(db, 'metric_samples');
    expect(ms.id.type).toBe('INTEGER');
    expect(ms.id.pk).toBe(1);
    expect(columnInfo(db, 'incidents').id.type).toBe('TEXT');
    expect(columnInfo(db, 'incidents').id.pk).toBe(1);
    // REAL affinity where §8 says REAL.
    expect(columnInfo(db, 'incidents').observed_value.type).toBe('REAL');
    expect(columnInfo(db, 'metric_samples').error_rate.type).toBe('REAL');
  });
});

/* ══ B. UNIQUE constraints ═══════════════════════════════════════════════ */

describe('B. UNIQUE constraints (§8)', () => {
  it('TC-08 customers.ingest_api_key UNIQUE', () => {
    db.dao.customers.create({ name: 'a', ingest_api_key: 'dupe' });
    expect(() => db.dao.customers.create({ name: 'b', ingest_api_key: 'dupe' })).toThrow();
  });

  it('TC-09 users.github_user_id UNIQUE', () => {
    const cid = seedCustomer();
    db.raw.prepare(
      `INSERT INTO users (id, github_user_id, github_login, avatar_url, access_token, customer_id, created_at)
       VALUES ('usr_1', 42, 'a', null, null, ?, 1)`,
    ).run(cid);
    expect(() =>
      db.raw.prepare(
        `INSERT INTO users (id, github_user_id, github_login, avatar_url, access_token, customer_id, created_at)
         VALUES ('usr_2', 42, 'b', null, null, ?, 1)`,
      ).run(cid),
    ).toThrow();
  });

  it('TC-10 services UNIQUE(customer_id,name); same name under another customer ok', () => {
    const c1 = seedCustomer();
    const c2 = seedCustomer();
    db.dao.services.touch(c1, 'checkout', 1000);
    expect(() =>
      db.raw.prepare(
        `INSERT INTO services (id, customer_id, name, first_event_at, last_event_at) VALUES ('svc_x', ?, 'checkout', 1, 1)`,
      ).run(c1),
    ).toThrow();
    // different customer, same name → allowed
    expect(() => db.dao.services.touch(c2, 'checkout', 1000)).not.toThrow();
  });

  it('TC-11 deploys UNIQUE(customer_id,sha); same sha under another customer ok', () => {
    const c1 = seedCustomer();
    const c2 = seedCustomer();
    const base = { sha: 'abc', short_sha: 'abc', ref: 'main', message: 'm', author: 'a', committed_at: 1, source: 'baseline' as const };
    db.dao.deploys.upsert({ customer_id: c1, ...base });
    // raw duplicate insert must violate the UNIQUE
    expect(() =>
      db.raw.prepare(
        `INSERT INTO deploys (id, customer_id, sha, short_sha, ref, message, author, committed_at, deployed_at, is_current, source, pr_id, created_at)
         VALUES ('dep_dup', ?, 'abc', 'abc', 'main', 'm', 'a', 1, null, 0, 'baseline', null, 1)`,
      ).run(c1),
    ).toThrow();
    expect(() => db.dao.deploys.upsert({ customer_id: c2, ...base })).not.toThrow();
  });
});

/* ══ C. Foreign keys (incl. cyclic) ══════════════════════════════════════ */

describe('C. foreign keys (§8)', () => {
  it('TC-12 child insert with unknown customer_id throws FK', () => {
    expect(() =>
      db.dao.services.touch('cus_nope', 'svc', 1),
    ).toThrow();
    expect(() =>
      db.dao.logEvents.insert({ customer_id: 'cus_nope', service: 's', level: 'info', message: 'm' }),
    ).toThrow();
  });

  it('TC-13 investigation_sessions.incident_id FK', () => {
    expect(() =>
      db.dao.sessions.create({ incident_id: 'inc_nope', mode: 'live', model: 'm' }),
    ).toThrow();
  });

  it('TC-14 investigation_steps.session_id FK', () => {
    expect(() =>
      db.dao.steps.append({ session_id: 'ses_nope', type: 'thought', content: 'x' }),
    ).toThrow();
  });

  it('TC-15 pull_requests.incident_id FK', () => {
    const cid = seedCustomer();
    expect(() =>
      db.dao.pullRequests.create({
        incident_id: 'inc_nope', customer_id: cid, github_pr_number: 1, github_pr_id: 1,
        branch: 'b', base_branch: 'main', title: 't', url: 'u', kind: 'revert',
        diagnostic_report: 'r', head_sha: 'sha',
      }),
    ).toThrow();
  });

  it('TC-16 cyclic FK incidents.pr_id ↔ pull_requests.incident_id works', () => {
    const cid = seedCustomer();
    const inc = db.dao.incidents.openOrDedup({
      customer_id: cid, service: 's', detector: 'error_rate', fingerprint: 'fp',
      title: 't', severity: 'high', threshold_value: 0.2, observed_value: 0.9,
    }).incident;
    expect(inc.pr_id).toBeNull();
    const pr = db.dao.pullRequests.create({
      incident_id: inc.id, customer_id: cid, github_pr_number: 7, github_pr_id: 700,
      branch: 'oncall-ai/fix', base_branch: 'main', title: 't', url: 'https://x',
      kind: 'revert', diagnostic_report: 'r', head_sha: 'def5678',
    });
    const linked = db.dao.incidents.update(inc.id, { pr_id: pr.id });
    expect(linked?.pr_id).toBe(pr.id);
    // both directions resolvable
    expect(db.dao.pullRequests.getById(pr.id)?.incident_id).toBe(inc.id);
  });

  it('TC-17 setting incidents.pr_id to a non-existent PR throws FK', () => {
    const cid = seedCustomer();
    const inc = db.dao.incidents.openOrDedup({
      customer_id: cid, service: 's', detector: 'error_rate', fingerprint: 'fp',
      title: 't', severity: 'high', threshold_value: 0.2, observed_value: 0.9,
    }).incident;
    expect(() => db.dao.incidents.update(inc.id, { pr_id: 'pr_ghost' })).toThrow();
  });

  it('TC-18 chat_messages.incident_id nullable FK', () => {
    // null incident → global chat, allowed
    expect(() => db.dao.chatMessages.insert({ incident_id: null, role: 'user', content: 'hi' })).not.toThrow();
    // bogus non-null incident → FK violation
    expect(() => db.dao.chatMessages.insert({ incident_id: 'inc_ghost', role: 'user', content: 'hi' })).toThrow();
  });
});

/* ══ D. ULID id prefixes ═════════════════════════════════════════════════ */

describe('D. id prefixes (§8)', () => {
  it('TC-19 every prefixed table stamps its §8 prefix', () => {
    const cid = db.dao.customers.create({ name: 'a', ingest_api_key: 'kk' }).id;
    expect(hasPrefix(cid, ID_PREFIX.customer)).toBe(true); // cus_
    const svc = db.dao.services.touch(cid, 's', 1).id;
    expect(hasPrefix(svc, ID_PREFIX.service)).toBe(true); // svc_
    const log = db.dao.logEvents.insert({ customer_id: cid, service: 's', level: 'info', message: 'm' }).id;
    expect(hasPrefix(log, ID_PREFIX.log_event)).toBe(true); // log_
    const inc = db.dao.incidents.openOrDedup({
      customer_id: cid, service: 's', detector: 'error_rate', fingerprint: 'fp',
      title: 't', severity: 'high', threshold_value: 0.2, observed_value: 0.9,
    }).incident.id;
    expect(hasPrefix(inc, ID_PREFIX.incident)).toBe(true); // inc_
    const ses = db.dao.sessions.create({ incident_id: inc, mode: 'live', model: 'm' }).id;
    expect(hasPrefix(ses, ID_PREFIX.session)).toBe(true); // ses_
    const stp = db.dao.steps.append({ session_id: ses, type: 'thought', content: 'x' }).id;
    expect(hasPrefix(stp, ID_PREFIX.step)).toBe(true); // stp_
    const dep = db.dao.deploys.upsert({ customer_id: cid, sha: 's1', short_sha: 's1', ref: 'main', message: 'm', author: 'a', committed_at: 1, source: 'baseline' }).id;
    expect(hasPrefix(dep, ID_PREFIX.deploy)).toBe(true); // dep_
    const pr = db.dao.pullRequests.create({ incident_id: inc, customer_id: cid, github_pr_number: 1, github_pr_id: 1, branch: 'b', base_branch: 'main', title: 't', url: 'u', kind: 'revert', diagnostic_report: 'r', head_sha: 'h' }).id;
    expect(hasPrefix(pr, ID_PREFIX.pull_request)).toBe(true); // pr_
    const msg = db.dao.chatMessages.insert({ incident_id: inc, role: 'user', content: 'c' }).id;
    expect(hasPrefix(msg, ID_PREFIX.chat_message)).toBe(true); // msg_
    const ntf = db.dao.notifications.insert({ incident_id: inc, channel: 'slack', status: 'stubbed', payload: {} }).id;
    expect(hasPrefix(ntf, ID_PREFIX.notification)).toBe(true); // ntf_
    // users prefix
    const usr = db.dao.users.upsertByGithubUserId({ github_user_id: 1, github_login: 'g' }).id;
    expect(hasPrefix(usr, ID_PREFIX.user)).toBe(true); // usr_
  });

  it('TC-20 metric_samples uses INTEGER autoincrement (no ULID)', () => {
    const cid = seedCustomer();
    const base = { customer_id: cid, service: 's', bucket_ts: 1, window_sec: 60, request_count: 10, error_count: 1, error_rate: 0.1, p50_ms: 10, p95_ms: 20, p99_ms: 30 };
    const a = db.dao.metricSamples.insert(base);
    const b = db.dao.metricSamples.insert({ ...base, bucket_ts: 2 });
    expect(typeof a.id).toBe('number');
    expect(typeof b.id).toBe('number');
    expect(b.id).toBeGreaterThan(a.id);
  });
});

/* ══ E. DAO round-trip per table ═════════════════════════════════════════ */

describe('E. DAO round-trips (§8)', () => {
  it('TC-21 customers round-trip incl. default_branch + null gh fields', () => {
    const c = db.dao.customers.create({ name: 'acme', ingest_api_key: 'rt-key' });
    expect(c.default_branch).toBe('main');
    expect(c.github_owner).toBeNull();
    const back = db.dao.customers.getById(c.id);
    expect(back).toEqual(c);
    expect(db.dao.customers.getByIngestKey('rt-key')?.id).toBe(c.id);
  });

  it('TC-22 users round-trip', () => {
    const cid = seedCustomer();
    const u = db.dao.users.upsertByGithubUserId({ github_user_id: 99, github_login: 'octo', avatar_url: 'http://a', access_token: 'gho_tok', customer_id: cid });
    const back = db.dao.users.getByGithubUserId(99);
    expect(back).toEqual(u);
    expect(back?.access_token).toBe('gho_tok');
  });

  it('TC-23 services round-trip + last_event_at advance', () => {
    const cid = seedCustomer();
    const s1 = db.dao.services.touch(cid, 'checkout', 1000);
    expect(s1.first_event_at).toBe(1000);
    const s2 = db.dao.services.touch(cid, 'checkout', 2000);
    expect(s2.id).toBe(s1.id);
    expect(s2.first_event_at).toBe(1000);
    expect(s2.last_event_at).toBe(2000);
  });

  it('TC-24 log_events round-trip incl. nullable fields', () => {
    const cid = seedCustomer();
    const full = db.dao.logEvents.insert({
      customer_id: cid, service: 'checkout', level: 'error', message: 'boom',
      timestamp: 111, received_at: 222, stack: 'TypeError', endpoint: '/api', method: 'POST',
      status: 500, latency_ms: 42, fingerprint_sig: 'sig',
    });
    expect(db.dao.logEvents.getById(full.id)).toEqual(full);
    const minimal = db.dao.logEvents.insert({ customer_id: cid, service: 's', level: 'info', message: 'ok' });
    const back = db.dao.logEvents.getById(minimal.id)!;
    expect(back.stack).toBeNull();
    expect(back.endpoint).toBeNull();
    expect(back.status).toBeNull();
    expect(back.latency_ms).toBeNull();
    expect(back.fingerprint_sig).toBeNull();
  });

  it('TC-25 metric_samples round-trip preserves REAL vs INTEGER', () => {
    const cid = seedCustomer();
    const m = db.dao.metricSamples.insert({ customer_id: cid, service: 's', bucket_ts: 5, window_sec: 60, request_count: 100, error_count: 25, error_rate: 0.25, p50_ms: 40, p95_ms: 120, p99_ms: 260 });
    const back = db.dao.metricSamples.latestForService(cid, 's')!;
    expect(back.error_rate).toBeCloseTo(0.25, 10);
    expect(back.p95_ms).toBe(120);
    expect(back.request_count).toBe(100);
    expect(back.id).toBe(m.id);
  });

  it('TC-26 incidents round-trip incl. nullables', () => {
    const cid = seedCustomer();
    const inc = db.dao.incidents.openOrDedup({
      customer_id: cid, service: 's', detector: 'latency', fingerprint: 'fp',
      title: 't', severity: 'medium', threshold_value: 1000, observed_value: 1500,
      first_error_at: 900, detected_at: 1000, opened_at: 1001, suspect_deploy_sha: 'abc',
    }).incident;
    expect(inc.root_cause).toBeNull();
    expect(inc.confidence).toBeNull();
    expect(inc.pr_id).toBeNull();
    expect(inc.resolved_at).toBeNull();
    expect(inc.postmortem).toBeNull();
    expect(inc.suspect_deploy_sha).toBe('abc');
    expect(db.dao.incidents.getById(inc.id)).toEqual(inc);
    const patched = db.dao.incidents.update(inc.id, { root_cause: 'null deref', confidence: 0.92 });
    expect(patched?.root_cause).toBe('null deref');
    expect(patched?.confidence).toBeCloseTo(0.92, 10);
  });

  it('TC-27 investigation_sessions round-trip incl. cost REAL', () => {
    const cid = seedCustomer();
    const inc = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', detector: 'error_rate', fingerprint: 'fp', title: 't', severity: 'high', threshold_value: 0.2, observed_value: 0.9 }).incident;
    const ses = db.dao.sessions.create({ incident_id: inc.id, mode: 'live', model: 'claude-sonnet-5' });
    expect(db.dao.sessions.getById(ses.id)).toEqual(ses);
    const done = db.dao.sessions.finish(ses.id, { status: 'completed', root_cause: 'rc', confidence: 0.9, decision: 'propose_fix', iterations: 4, input_tokens: 1000, output_tokens: 200, cost_usd: 0.06 });
    expect(done?.cost_usd).toBeCloseTo(0.06, 10);
    expect(done?.decision).toBe('propose_fix');
    expect(done?.status).toBe('completed');
  });

  it('TC-28 investigation_steps round-trip with JSON tool_input/output', () => {
    const cid = seedCustomer();
    const inc = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', detector: 'error_rate', fingerprint: 'fp', title: 't', severity: 'high', threshold_value: 0.2, observed_value: 0.9 }).incident;
    const ses = db.dao.sessions.create({ incident_id: inc.id, mode: 'live', model: 'm' }).id;
    const input = { service: 'checkout', limit: 30 };
    const output = { total_matched: 5, events: [{ ts: 1, level: 'error' }], patterns: [{ signature: 'x', count: 2 }] };
    const step = db.dao.steps.append({ session_id: ses, type: 'tool_call', tool_name: 'search_logs', tool_input: input, tool_output: output });
    const back = db.dao.steps.listBySession(ses)[0];
    expect(back.tool_input).toEqual(input);
    expect(back.tool_output).toEqual(output);
    expect(back.seq).toBe(0);
    expect(step.tool_name).toBe('search_logs');
  });

  it('TC-29 deploys round-trip with is_current + source enum', () => {
    const cid = seedCustomer();
    const d = db.dao.deploys.upsert({ customer_id: cid, sha: 'sha1', short_sha: 'sha1', ref: 'main', message: 'bad', author: 'ai', committed_at: 10, source: 'bad_deploy', is_current: true });
    expect(d.is_current).toBe(true);
    const back = db.dao.deploys.getBySha(cid, 'sha1')!;
    expect(back.is_current).toBe(true);
    expect(back.source).toBe('bad_deploy');
    expect(back.deployed_at).toBeNull();
  });

  it('TC-30 pull_requests round-trip', () => {
    const cid = seedCustomer();
    const inc = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', detector: 'error_rate', fingerprint: 'fp', title: 't', severity: 'high', threshold_value: 0.2, observed_value: 0.9 }).incident;
    const pr = db.dao.pullRequests.create({ incident_id: inc.id, customer_id: cid, github_pr_number: 7, github_pr_id: 700, branch: 'b', base_branch: 'main', title: 'fix', url: 'https://x', kind: 'revert', diagnostic_report: '## report', head_sha: 'def' });
    expect(pr.state).toBe('open');
    expect(pr.verification_status).toBe('pending');
    expect(pr.merged_at).toBeNull();
    expect(pr.verification_comment_id).toBeNull();
    expect(db.dao.pullRequests.getById(pr.id)).toEqual(pr);
  });

  it('TC-31 chat_messages round-trip with JSON evidence array', () => {
    const cid = seedCustomer();
    const inc = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', detector: 'error_rate', fingerprint: 'fp', title: 't', severity: 'high', threshold_value: 0.2, observed_value: 0.9 }).incident;
    const evidence = [{ type: 'tool' as const, tool: 'get_deploy_diff', ref: 'abc1234' }];
    const msg = db.dao.chatMessages.insert({ incident_id: inc.id, role: 'assistant', content: 'because', evidence });
    const back = db.dao.chatMessages.listByIncident(inc.id)[0];
    expect(back.evidence).toEqual(evidence);
    const noEv = db.dao.chatMessages.insert({ incident_id: inc.id, role: 'user', content: 'q' });
    expect(noEv.evidence).toBeNull();
  });

  it('TC-32 notifications round-trip with JSON payload', () => {
    const cid = seedCustomer();
    const inc = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', detector: 'error_rate', fingerprint: 'fp', title: 't', severity: 'high', threshold_value: 0.2, observed_value: 0.9 }).incident;
    const payload = { text: 'Incident opened', blocks: [{ type: 'section' }] };
    const n = db.dao.notifications.insert({ incident_id: inc.id, channel: 'slack', status: 'stubbed', payload });
    expect(n.payload).toEqual(payload);
    expect(db.dao.notifications.listByIncident(inc.id)[0].payload).toEqual(payload);
  });
});

/* ══ F. Codecs ═══════════════════════════════════════════════════════════ */

describe('F. codecs (§8)', () => {
  it('TC-33 JSON codec deep round-trips + null handling', () => {
    const v = { a: 1, b: [true, { c: 'x' }], d: null };
    expect(fromJson(toJson(v))).toEqual(v);
    expect(toJson(null)).toBeNull();
    expect(toJson(undefined)).toBeNull();
    expect(fromJson(null)).toBeNull();
  });

  it('TC-34 0/1 bool codec', () => {
    expect(boolToInt(true)).toBe(1);
    expect(boolToInt(false)).toBe(0);
    expect(intToBool(1)).toBe(true);
    expect(intToBool(0)).toBe(false);
    // stored as integer, DAO returns boolean, round-trips false too
    const cid = seedCustomer();
    db.dao.deploys.upsert({ customer_id: cid, sha: 's', short_sha: 's', ref: 'main', message: 'm', author: 'a', committed_at: 1, source: 'baseline', is_current: false });
    const raw = db.raw.prepare(`SELECT is_current FROM deploys WHERE customer_id = ? AND sha = 's'`).get(cid) as { is_current: number };
    expect(raw.is_current).toBe(0);
    expect(db.dao.deploys.getBySha(cid, 's')?.is_current).toBe(false);
  });

  it('TC-35 stack truncated to 8 KB on write', () => {
    const cid = seedCustomer();
    const big = 'x'.repeat(10_000);
    expect(Buffer.byteLength(truncateStack(big)!, 'utf8')).toBeLessThanOrEqual(STACK_MAX_BYTES);
    const ev = db.dao.logEvents.insert({ customer_id: cid, service: 's', level: 'error', message: 'm', stack: big });
    const back = db.dao.logEvents.getById(ev.id)!;
    expect(Buffer.byteLength(back.stack!, 'utf8')).toBeLessThanOrEqual(STACK_MAX_BYTES);
    // a short stack is stored verbatim
    const small = db.dao.logEvents.insert({ customer_id: cid, service: 's', level: 'error', message: 'm', stack: 'short' });
    expect(db.dao.logEvents.getById(small.id)!.stack).toBe('short');
  });
});

/* ══ G. Incidents dedup (headline rule §8 + §10.2) ═══════════════════════ */

describe('G. incidents dedup (§8 code-enforced)', () => {
  const key = { detector: 'error_rate' as const, fingerprint: 'fp-1', title: 't', severity: 'high' as const, threshold_value: 0.2 };

  function countFp(cid: string, service: string, fp: string): number {
    return (db.raw.prepare(`SELECT COUNT(*) n FROM incidents WHERE customer_id=? AND service=? AND fingerprint=?`).get(cid, service, fp) as { n: number }).n;
  }

  it('TC-36 non-terminal dedup UPDATES, not inserts', () => {
    const cid = seedCustomer();
    const r1 = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.5 });
    expect(r1.deduped).toBe(false);
    const before = db.dao.incidents.getById(r1.incident.id)!.updated_at;
    const r2 = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.87 });
    expect(r2.deduped).toBe(true);
    expect(r2.incident.id).toBe(r1.incident.id);
    expect(countFp(cid, 's', 'fp-1')).toBe(1);
    expect(r2.incident.observed_value).toBeCloseTo(0.87, 10);
    expect(r2.incident.updated_at).toBeGreaterThanOrEqual(before);
  });

  it('TC-37 dedup applies in EVERY non-terminal status', () => {
    const nonTerminal = ['open', 'investigating', 'fix_proposed', 'escalated', 'awaiting_merge', 'verifying'] as const;
    for (const status of nonTerminal) {
      const cid = seedCustomer();
      const r1 = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.5 });
      db.dao.incidents.setStatus(r1.incident.id, status);
      expect(isTerminalStatus(status)).toBe(false);
      const r2 = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.9 });
      expect(r2.deduped, `status ${status} should dedup`).toBe(true);
      expect(r2.incident.id).toBe(r1.incident.id);
      expect(countFp(cid, 's', 'fp-1')).toBe(1);
    }
  });

  it('TC-38 terminal `resolved` does NOT dedup → new incident', () => {
    const cid = seedCustomer();
    const r1 = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.5 });
    db.dao.incidents.setStatus(r1.incident.id, 'resolved');
    expect(isTerminalStatus('resolved')).toBe(true);
    const r2 = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.9 });
    expect(r2.deduped).toBe(false);
    expect(r2.incident.id).not.toBe(r1.incident.id);
    expect(countFp(cid, 's', 'fp-1')).toBe(2);
  });

  it('TC-39 terminal `closed` does NOT dedup → new incident', () => {
    const cid = seedCustomer();
    const r1 = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.5 });
    db.dao.incidents.setStatus(r1.incident.id, 'closed');
    expect(isTerminalStatus('closed')).toBe(true);
    const r2 = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.9 });
    expect(r2.deduped).toBe(false);
    expect(r2.incident.id).not.toBe(r1.incident.id);
    expect(countFp(cid, 's', 'fp-1')).toBe(2);
    expect([...TERMINAL_STATUSES].sort()).toEqual(['closed', 'resolved']);
  });

  it('TC-40 different fingerprint → new incident', () => {
    const cid = seedCustomer();
    const a = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.5 });
    const b = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, fingerprint: 'fp-2', observed_value: 0.5 });
    expect(b.deduped).toBe(false);
    expect(b.incident.id).not.toBe(a.incident.id);
  });

  it('TC-41 different service → new incident', () => {
    const cid = seedCustomer();
    const a = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's1', ...key, observed_value: 0.5 });
    const b = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's2', ...key, observed_value: 0.5 });
    expect(b.deduped).toBe(false);
    expect(b.incident.id).not.toBe(a.incident.id);
  });

  it('TC-42 different customer → new incident', () => {
    const c1 = seedCustomer();
    const c2 = seedCustomer();
    const a = db.dao.incidents.openOrDedup({ customer_id: c1, service: 's', ...key, observed_value: 0.5 });
    const b = db.dao.incidents.openOrDedup({ customer_id: c2, service: 's', ...key, observed_value: 0.5 });
    expect(b.deduped).toBe(false);
    expect(b.incident.id).not.toBe(a.incident.id);
  });

  it('TC-43 dedup net effect is exactly one row change (atomic find-or-update)', () => {
    const cid = seedCustomer();
    const r1 = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.5 });
    const totalBefore = (db.raw.prepare(`SELECT COUNT(*) n FROM incidents`).get() as { n: number }).n;
    const r2 = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.99 });
    const totalAfter = (db.raw.prepare(`SELECT COUNT(*) n FROM incidents`).get() as { n: number }).n;
    expect(totalAfter).toBe(totalBefore); // update, not insert
    expect(r2.incident.id).toBe(r1.incident.id);
    expect(db.dao.incidents.getById(r1.incident.id)!.observed_value).toBeCloseTo(0.99, 10);
  });

  it('TC-44 resolved + live same key → dedup updates the LIVE one only', () => {
    const cid = seedCustomer();
    // A: create then resolve
    const a = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.5 });
    db.dao.incidents.setStatus(a.incident.id, 'resolved');
    // B: same key, now inserts fresh (A is terminal)
    const b = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.6 });
    expect(b.deduped).toBe(false);
    expect(b.incident.id).not.toBe(a.incident.id);
    // C: same key again → must dedup the live B, never touch resolved A
    const c = db.dao.incidents.openOrDedup({ customer_id: cid, service: 's', ...key, observed_value: 0.95 });
    expect(c.deduped).toBe(true);
    expect(c.incident.id).toBe(b.incident.id);
    expect(db.dao.incidents.getById(a.incident.id)!.observed_value).toBeCloseTo(0.5, 10); // untouched
    expect(db.dao.incidents.getById(b.incident.id)!.observed_value).toBeCloseTo(0.95, 10);
    expect(countFp(cid, 's', 'fp-1')).toBe(2);
  });
});
