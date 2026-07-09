import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  openMemoryDatabase,
  type OncallDb,
  hasPrefix,
  ID_PREFIX,
  STACK_MAX_BYTES,
} from '../src/db/index.js';

/**
 * C2 self-verification — DAO round-trips + enforced invariants (SPEC §8).
 * Every DAO is exercised insert→read; the incidents dedup rule, JSON/boolean
 * codecs, FK enforcement, UNIQUE constraints, and stack truncation are checked.
 */

let db: OncallDb;

beforeEach(() => {
  db = openMemoryDatabase();
});
afterEach(() => {
  db.close();
});

/** Seed a customer and return its id. */
function seedCustomer(key = 'ingest-key-1'): string {
  return db.dao.customers.create({ name: 'acme', ingest_api_key: key }).id;
}

describe('customers DAO', () => {
  it('round-trips and looks up by id + ingest key', () => {
    const c = db.dao.customers.create({
      name: 'acme',
      ingest_api_key: 'k1',
    });
    expect(hasPrefix(c.id, ID_PREFIX.customer)).toBe(true);
    expect(c.default_branch).toBe('main');
    expect(db.dao.customers.getById(c.id)).toEqual(c);
    expect(db.dao.customers.getByIngestKey('k1')?.id).toBe(c.id);
    expect(db.dao.customers.getByIngestKey('nope')).toBeNull();
  });

  it('setRepo binds owner/repo/default_branch', () => {
    const c = seedCustomer();
    const updated = db.dao.customers.setRepo(c, 'DIVIJ08070', 'oncall-ai-victim', 'main');
    expect(updated?.github_owner).toBe('DIVIJ08070');
    expect(updated?.github_repo).toBe('oncall-ai-victim');
  });

  it('enforces UNIQUE ingest_api_key', () => {
    db.dao.customers.create({ name: 'a', ingest_api_key: 'dup' });
    expect(() =>
      db.dao.customers.create({ name: 'b', ingest_api_key: 'dup' }),
    ).toThrow(/UNIQUE/i);
  });
});

describe('users DAO', () => {
  it('upserts by github_user_id (insert then refresh)', () => {
    const customerId = seedCustomer();
    const u1 = db.dao.users.upsertByGithubUserId({
      github_user_id: 42,
      github_login: 'octocat',
      avatar_url: 'https://a',
      access_token: 'tok-1',
      customer_id: customerId,
    });
    expect(hasPrefix(u1.id, ID_PREFIX.user)).toBe(true);

    const u2 = db.dao.users.upsertByGithubUserId({
      github_user_id: 42,
      github_login: 'octocat-renamed',
      avatar_url: 'https://b',
    });
    expect(u2.id).toBe(u1.id); // same row
    expect(u2.github_login).toBe('octocat-renamed');
    expect(u2.access_token).toBe('tok-1'); // preserved when omitted
    expect(db.dao.users.getByGithubUserId(42)?.id).toBe(u1.id);
  });

  it('enforces UNIQUE github_user_id at the DB level', () => {
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO users (id, github_user_id, github_login, created_at)
           VALUES ('usr_a', 7, 'a', 1), ('usr_b', 7, 'b', 1)`,
        )
        .run(),
    ).toThrow(/UNIQUE/i);
  });
});

describe('services DAO', () => {
  it('touch upserts and advances last_event_at monotonically', () => {
    const customerId = seedCustomer();
    const s1 = db.dao.services.touch(customerId, 'checkout-api', 1000);
    expect(hasPrefix(s1.id, ID_PREFIX.service)).toBe(true);
    expect(s1.first_event_at).toBe(1000);

    const s2 = db.dao.services.touch(customerId, 'checkout-api', 2000);
    expect(s2.id).toBe(s1.id); // same (customer, name)
    expect(s2.last_event_at).toBe(2000);
    expect(s2.first_event_at).toBe(1000);

    // An older event must not move last_event_at backward.
    const s3 = db.dao.services.touch(customerId, 'checkout-api', 500);
    expect(s3.last_event_at).toBe(2000);
    expect(s3.first_event_at).toBe(500);
    expect(db.dao.services.listByCustomer(customerId)).toHaveLength(1);
  });
});

describe('log_events DAO', () => {
  it('inserts single + batch and queries with filters', () => {
    const customerId = seedCustomer();
    const one = db.dao.logEvents.insert({
      customer_id: customerId,
      service: 'checkout-api',
      level: 'error',
      message: 'boom',
      timestamp: 5000,
      status: 500,
      latency_ms: 42,
      fingerprint_sig: 'sig-a',
    });
    expect(hasPrefix(one.id, ID_PREFIX.log_event)).toBe(true);
    expect(one.received_at).toBeGreaterThan(0);

    db.dao.logEvents.insertMany([
      { customer_id: customerId, service: 'checkout-api', level: 'info', message: 'ok', timestamp: 6000 },
      { customer_id: customerId, service: 'reports-api', level: 'warn', message: 'slow', timestamp: 7000 },
    ]);

    expect(db.dao.logEvents.countByCustomer(customerId)).toBe(3);
    const errors = db.dao.logEvents.query({ customer_id: customerId, level: 'error' });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('boom');

    // newest-first ordering + keyset pagination
    const newest = db.dao.logEvents.query({ customer_id: customerId, limit: 1 });
    expect(newest[0].timestamp).toBe(7000);
    const older = db.dao.logEvents.query({ customer_id: customerId, before: 7000, limit: 1 });
    expect(older[0].timestamp).toBe(6000);
  });

  it('truncates stack to 8 KB on write', () => {
    const customerId = seedCustomer();
    const big = 'x'.repeat(STACK_MAX_BYTES + 5000);
    const row = db.dao.logEvents.insert({
      customer_id: customerId,
      service: 's',
      level: 'error',
      message: 'm',
      stack: big,
    });
    expect(Buffer.byteLength(row.stack ?? '', 'utf8')).toBeLessThanOrEqual(STACK_MAX_BYTES);
    expect(db.dao.logEvents.getById(row.id)?.stack?.length).toBeLessThanOrEqual(STACK_MAX_BYTES);
  });

  it('enforces the customer_id foreign key', () => {
    expect(() =>
      db.dao.logEvents.insert({
        customer_id: 'cus_missing',
        service: 's',
        level: 'error',
        message: 'm',
      }),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe('metric_samples DAO', () => {
  it('inserts with autoincrement id and reads series', () => {
    const customerId = seedCustomer();
    const base = {
      customer_id: customerId,
      service: 'checkout-api',
      window_sec: 60,
      request_count: 100,
      error_count: 30,
      error_rate: 0.3,
      p50_ms: 40,
      p95_ms: 120,
      p99_ms: 260,
    };
    const a = db.dao.metricSamples.insert({ ...base, bucket_ts: 1000 });
    const b = db.dao.metricSamples.insert({ ...base, bucket_ts: 2000 });
    expect(typeof a.id).toBe('number');
    expect(b.id).toBe((a.id as number) + 1); // autoincrement

    expect(db.dao.metricSamples.latestForService(customerId, 'checkout-api')?.bucket_ts).toBe(2000);
    const series = db.dao.metricSamples.seriesForService(customerId, 'checkout-api', 0);
    expect(series.map((s) => s.bucket_ts)).toEqual([1000, 2000]); // ascending
  });
});

describe('incidents DAO — code-enforced dedup (SPEC §8)', () => {
  function openInput(customerId: string, overrides: Record<string, unknown> = {}) {
    return {
      customer_id: customerId,
      service: 'checkout-api',
      detector: 'error_rate' as const,
      fingerprint: 'fp-1',
      title: 'Error-rate spike',
      severity: 'high' as const,
      threshold_value: 0.2,
      observed_value: 0.8,
      ...overrides,
    };
  }

  it('dedups a live incident: updates observed_value instead of inserting', () => {
    const customerId = seedCustomer();
    const first = db.dao.incidents.openOrDedup(openInput(customerId));
    expect(first.deduped).toBe(false);
    expect(hasPrefix(first.incident.id, ID_PREFIX.incident)).toBe(true);

    const second = db.dao.incidents.openOrDedup(openInput(customerId, { observed_value: 0.95 }));
    expect(second.deduped).toBe(true);
    expect(second.incident.id).toBe(first.incident.id); // same incident
    expect(second.incident.observed_value).toBe(0.95); // advanced
    expect(db.dao.incidents.list({ customer_id: customerId })).toHaveLength(1);
  });

  it('opens a NEW incident when the prior one is terminal (resolved)', () => {
    const customerId = seedCustomer();
    const first = db.dao.incidents.openOrDedup(openInput(customerId));
    db.dao.incidents.setStatus(first.incident.id, 'resolved');

    const second = db.dao.incidents.openOrDedup(openInput(customerId));
    expect(second.deduped).toBe(false);
    expect(second.incident.id).not.toBe(first.incident.id);
    expect(db.dao.incidents.list({ customer_id: customerId })).toHaveLength(2);
  });

  it('still dedups against an escalated incident (non-terminal)', () => {
    const customerId = seedCustomer();
    const first = db.dao.incidents.openOrDedup(openInput(customerId));
    db.dao.incidents.setStatus(first.incident.id, 'escalated');

    const second = db.dao.incidents.openOrDedup(openInput(customerId));
    expect(second.deduped).toBe(true);
    expect(second.incident.id).toBe(first.incident.id);
  });

  it('a different fingerprint opens a separate incident', () => {
    const customerId = seedCustomer();
    db.dao.incidents.openOrDedup(openInput(customerId));
    const other = db.dao.incidents.openOrDedup(openInput(customerId, { fingerprint: 'fp-2' }));
    expect(other.deduped).toBe(false);
    expect(db.dao.incidents.list({ customer_id: customerId })).toHaveLength(2);
  });

  it('update() patches lifecycle fields and bumps updated_at', () => {
    const customerId = seedCustomer();
    const { incident } = db.dao.incidents.openOrDedup(openInput(customerId));
    const patched = db.dao.incidents.update(incident.id, {
      status: 'fix_proposed',
      root_cause: 'null deref',
      confidence: 0.92,
      resolved_at: null,
    });
    expect(patched?.status).toBe('fix_proposed');
    expect(patched?.root_cause).toBe('null deref');
    expect(patched?.confidence).toBe(0.92);
    expect(patched?.updated_at).toBeGreaterThanOrEqual(incident.updated_at);

    const active = db.dao.incidents.findActiveByFingerprint(customerId, 'checkout-api', 'fp-1');
    expect(active?.id).toBe(incident.id);
  });
});

describe('investigation sessions + steps DAO', () => {
  function seedIncident(customerId: string): string {
    return db.dao.incidents.openOrDedup({
      customer_id: customerId,
      service: 'checkout-api',
      detector: 'error_rate',
      fingerprint: 'fp',
      title: 't',
      severity: 'high',
      threshold_value: 0.2,
      observed_value: 0.8,
    }).incident.id;
  }

  it('creates a running session then finishes it with findings', () => {
    const customerId = seedCustomer();
    const incidentId = seedIncident(customerId);
    const s = db.dao.sessions.create({ incident_id: incidentId, mode: 'live', model: 'claude-sonnet-5' });
    expect(hasPrefix(s.id, ID_PREFIX.session)).toBe(true);
    expect(s.status).toBe('running');

    const done = db.dao.sessions.finish(s.id, {
      status: 'completed',
      root_cause: 'bad deploy',
      confidence: 0.9,
      decision: 'propose_fix',
      iterations: 4,
      input_tokens: 1200,
      output_tokens: 800,
      cost_usd: 0.06,
    });
    expect(done?.status).toBe('completed');
    expect(done?.decision).toBe('propose_fix');
    expect(done?.completed_at).not.toBeNull();
    expect(db.dao.sessions.latestForIncident(incidentId)?.id).toBe(s.id);
  });

  it('appends steps with monotonic seq and JSON round-trip', () => {
    const customerId = seedCustomer();
    const incidentId = seedIncident(customerId);
    const s = db.dao.sessions.create({ incident_id: incidentId, mode: 'live', model: 'm' });

    const st1 = db.dao.steps.append({ session_id: s.id, type: 'thought', content: 'hmm' });
    const st2 = db.dao.steps.append({
      session_id: s.id,
      type: 'tool_call',
      tool_name: 'search_logs',
      tool_input: { service: 'checkout-api', limit: 30 },
    });
    const st3 = db.dao.steps.append({
      session_id: s.id,
      type: 'tool_result',
      tool_name: 'search_logs',
      tool_output: { total_matched: 12, returned: 5, patterns: [{ signature: 'x', count: 7 }] },
    });
    expect(hasPrefix(st1.id, ID_PREFIX.step)).toBe(true);
    expect([st1.seq, st2.seq, st3.seq]).toEqual([0, 1, 2]);

    const stored = db.dao.steps.listBySession(s.id);
    expect(stored).toHaveLength(3);
    expect(stored[1].tool_input).toEqual({ service: 'checkout-api', limit: 30 }); // parsed object
    expect((stored[2].tool_output as { total_matched: number }).total_matched).toBe(12);
    expect(stored[0].tool_input).toBeNull();
    expect(db.dao.steps.countBySession(s.id)).toBe(3);
  });
});

describe('deploys DAO', () => {
  it('upserts by (customer_id, sha) and round-trips is_current boolean', () => {
    const customerId = seedCustomer();
    const d = db.dao.deploys.upsert({
      customer_id: customerId,
      sha: 'abc1234def',
      short_sha: 'abc1234',
      ref: 'refs/heads/main',
      message: 'remove null guard',
      author: 'dev',
      committed_at: 1000,
      source: 'bad_deploy',
    });
    expect(hasPrefix(d.id, ID_PREFIX.deploy)).toBe(true);
    expect(d.is_current).toBe(false); // boolean, not 0

    // Upsert same sha updates in place (no duplicate row).
    const d2 = db.dao.deploys.upsert({
      customer_id: customerId,
      sha: 'abc1234def',
      short_sha: 'abc1234',
      ref: 'refs/heads/main',
      message: 'remove null guard (amended)',
      author: 'dev',
      committed_at: 1000,
      source: 'bad_deploy',
    });
    expect(d2.id).toBe(d.id);
    expect(d2.message).toBe('remove null guard (amended)');
    expect(db.dao.deploys.listRecent(customerId)).toHaveLength(1);
  });

  it('markCurrent flips exactly one row', () => {
    const customerId = seedCustomer();
    const mk = (sha: string, ts: number) =>
      db.dao.deploys.upsert({
        customer_id: customerId,
        sha,
        short_sha: sha.slice(0, 7),
        ref: 'refs/heads/main',
        message: sha,
        author: 'a',
        committed_at: ts,
        source: 'baseline',
        is_current: true,
      });
    mk('sha-old', 1000);
    mk('sha-new', 2000);
    db.dao.deploys.markCurrent(customerId, 'sha-new');
    const current = db.dao.deploys.getCurrent(customerId);
    expect(current?.sha).toBe('sha-new');
    expect(current?.is_current).toBe(true);
    expect(db.dao.deploys.getBySha(customerId, 'sha-old')?.is_current).toBe(false);
  });

  it('enforces UNIQUE(customer_id, sha) at the DB level', () => {
    const customerId = seedCustomer();
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO deploys (id, customer_id, sha, short_sha, ref, message, author, committed_at, is_current, source, created_at)
           VALUES ('dep_a', @c, 's', 's', 'r', 'm', 'a', 1, 0, 'baseline', 1),
                  ('dep_b', @c, 's', 's', 'r', 'm', 'a', 1, 0, 'baseline', 1)`,
        )
        .run({ c: customerId }),
    ).toThrow(/UNIQUE/i);
  });
});

describe('pull_requests DAO', () => {
  it('creates a PR, links it back onto the incident, and updates state', () => {
    const customerId = seedCustomer();
    const incidentId = db.dao.incidents.openOrDedup({
      customer_id: customerId,
      service: 'checkout-api',
      detector: 'error_rate',
      fingerprint: 'fp',
      title: 't',
      severity: 'high',
      threshold_value: 0.2,
      observed_value: 0.8,
    }).incident.id;

    const pr = db.dao.pullRequests.create({
      incident_id: incidentId,
      customer_id: customerId,
      github_pr_number: 7,
      github_pr_id: 999,
      branch: 'oncall-ai/fix-x',
      base_branch: 'main',
      title: 'Revert bad deploy',
      url: 'https://github.com/o/r/pull/7',
      kind: 'revert',
      diagnostic_report: '## Root Cause\n...',
      head_sha: 'def5678',
    });
    expect(hasPrefix(pr.id, ID_PREFIX.pull_request)).toBe(true);
    expect(pr.state).toBe('open');
    expect(pr.verification_status).toBe('pending');

    // Back-fill the cyclic FK incidents.pr_id → pull_requests.id
    const linked = db.dao.incidents.update(incidentId, { pr_id: pr.id, status: 'fix_proposed' });
    expect(linked?.pr_id).toBe(pr.id);

    const merged = db.dao.pullRequests.update(pr.id, {
      state: 'merged',
      merged_at: 123,
      verification_status: 'recovered',
      verification_comment_id: 55,
    });
    expect(merged?.state).toBe('merged');
    expect(merged?.verification_status).toBe('recovered');
    expect(db.dao.pullRequests.getByIncident(incidentId)?.id).toBe(pr.id);
    expect(db.dao.pullRequests.listByState(customerId, 'merged')).toHaveLength(1);
  });
});

describe('chat_messages DAO', () => {
  it('round-trips evidence JSON and lists by incident', () => {
    const customerId = seedCustomer();
    const incidentId = db.dao.incidents.openOrDedup({
      customer_id: customerId,
      service: 's',
      detector: 'error_rate',
      fingerprint: 'fp',
      title: 't',
      severity: 'low',
      threshold_value: 0.2,
      observed_value: 0.8,
    }).incident.id;

    db.dao.chatMessages.insert({ incident_id: incidentId, role: 'user', content: 'why?' });
    const a = db.dao.chatMessages.insert({
      incident_id: incidentId,
      role: 'assistant',
      content: 'because deploy abc',
      evidence: [{ type: 'tool', tool: 'get_deploy_diff', ref: 'abc1234' }],
    });
    expect(hasPrefix(a.id, ID_PREFIX.chat_message)).toBe(true);

    const msgs = db.dao.chatMessages.listByIncident(incidentId);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].evidence).toBeNull();
    expect(msgs[1].evidence).toEqual([{ type: 'tool', tool: 'get_deploy_diff', ref: 'abc1234' }]);
  });
});

describe('notifications DAO', () => {
  it('round-trips payload JSON', () => {
    const customerId = seedCustomer();
    const incidentId = db.dao.incidents.openOrDedup({
      customer_id: customerId,
      service: 's',
      detector: 'silence',
      fingerprint: 'fp',
      title: 't',
      severity: 'medium',
      threshold_value: 0,
      observed_value: 0,
    }).incident.id;

    const n = db.dao.notifications.insert({
      incident_id: incidentId,
      channel: 'slack',
      status: 'stubbed',
      payload: { text: 'incident opened', blocks: [1, 2, 3] },
    });
    expect(hasPrefix(n.id, ID_PREFIX.notification)).toBe(true);
    const listed = db.dao.notifications.listByIncident(incidentId);
    expect(listed).toHaveLength(1);
    expect(listed[0].payload).toEqual({ text: 'incident opened', blocks: [1, 2, 3] });
  });
});
