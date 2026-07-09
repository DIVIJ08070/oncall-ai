import { describe, it, expect, afterEach } from 'vitest';
import { openMemoryDatabase, type OncallDb } from '../src/db/index.js';
import { loadConfig, type Config } from '../src/config.js';
import { ManualClock } from '../src/detection/clock.js';
import { emptyRollup, type Rollup } from '../src/metrics/rollup.js';
import {
  MergePoller,
  type MergePollerOctokit,
  type MergePollerPull,
  type VictimHealer,
} from '../src/github/merge-poller.js';

/**
 * C9 — merge poller + recovery verifier (SPEC §10.5, FR-12).
 * Fully deterministic: injected `ManualClock` + a fake Octokit (returns merged) +
 * a spy healer + an injected `sampleRollup`. No network, no wall-clock, no live
 * merge on the real repo. Asserts: deploy row + heal call + verifying→resolved
 * transition + the PR recovery comment.
 */

const T0 = 1_700_000_000_000;
const RECOVERY_SUSTAIN_MS = 30_000; // SPEC §10.5 "≥ 30s"

/** A healthy trailing-window rollup (error rate 0, low p95, traffic present). */
function healthyRollup(): Rollup {
  return { ...emptyRollup(), request_count: 40, raw_request_count: 40, p50_ms: 30, p95_ms: 120, p99_ms: 200 };
}
/** An unhealthy rollup that keeps breaching the error-rate threshold. */
function unhealthyRollup(): Rollup {
  return { ...emptyRollup(), request_count: 40, raw_request_count: 40, error_count: 40, error_rate: 1, p50_ms: 30, p95_ms: 120, p99_ms: 200 };
}

interface FakeGithub {
  octokit: MergePollerOctokit;
  comments: Array<{ issue_number: number; body: string }>;
  getCalls: number;
}

function fakeGithub(pull: MergePollerPull): FakeGithub {
  const state = { comments: [] as Array<{ issue_number: number; body: string }>, getCalls: 0, commentId: 999 };
  const octokit: MergePollerOctokit = {
    rest: {
      pulls: {
        async get() {
          state.getCalls++;
          return { data: pull };
        },
      },
      issues: {
        async createComment(p) {
          state.comments.push({ issue_number: p.issue_number, body: p.body });
          return { data: { id: state.commentId } };
        },
      },
      repos: {
        async getCommit() {
          return {
            data: {
              sha: 'merge_sha_abcdef',
              commit: {
                message: 'Merge PR #7: revert bad deploy\n\ndetails',
                author: { name: 'Divij', date: new Date(T0).toISOString() },
              },
              author: { login: 'DIVIJ08070' },
            },
          };
        },
      },
    },
  };
  return {
    octokit,
    get comments() {
      return state.comments;
    },
    get getCalls() {
      return state.getCalls;
    },
  };
}

interface Fixture {
  db: OncallDb;
  config: Config;
  customerId: string;
  incidentId: string;
  prId: string;
  prNumber: number;
}

/** Seed a customer + an incident in `awaiting_merge` with an open PR row. */
function seed(): Fixture {
  const db = openMemoryDatabase();
  const config = loadConfig({ GITHUB_OWNER: 'DIVIJ08070', GITHUB_REPO: 'oncall-ai-victim' });
  const customer = db.dao.customers.create({ name: 'demo', ingest_api_key: 'k' });
  db.dao.services.touch(customer.id, 'checkout-api', T0);

  const { incident } = db.dao.incidents.openOrDedup({
    customer_id: customer.id,
    service: 'checkout-api',
    detector: 'error_rate',
    fingerprint: 'fp-1',
    title: 'Error-rate spike on checkout-api',
    severity: 'high',
    threshold_value: 0.2,
    observed_value: 0.9,
    detected_at: T0,
    opened_at: T0,
  });
  const pr = db.dao.pullRequests.create({
    incident_id: incident.id,
    customer_id: customer.id,
    github_pr_number: 7,
    github_pr_id: 1001,
    branch: 'oncall-ai/fix-x',
    base_branch: 'main',
    title: 'Revert bad deploy',
    url: 'https://github.com/DIVIJ08070/oncall-ai-victim/pull/7',
    kind: 'revert',
    diagnostic_report: '## Root Cause\nnull deref',
    head_sha: 'headsha1',
  });
  db.dao.incidents.update(incident.id, { status: 'awaiting_merge', pr_id: pr.id });

  return { db, config, customerId: customer.id, incidentId: incident.id, prId: pr.id, prNumber: 7 };
}

const mergedPull: MergePollerPull = {
  merged: true,
  merged_at: new Date(T0).toISOString(),
  merge_commit_sha: 'merge_sha_abcdef',
  state: 'closed',
};

let f: Fixture;
afterEach(() => {
  if (f) f.db.close();
});

describe('merge → verifying → resolved (recovery confirmed)', () => {
  it('records the merge deploy, heals the victim, and enters verifying on merge', async () => {
    f = seed();
    const gh = fakeGithub(mergedPull);
    const clock = new ManualClock(T0);
    let healCalls = 0;
    const healer: VictimHealer = { heal: async () => void healCalls++ };
    const poller = new MergePoller({
      db: f.db,
      config: f.config,
      octokit: gh.octokit,
      clock,
      healer,
      sampleRollup: () => healthyRollup(),
    });

    const r1 = await poller.poll();
    expect(r1.merged.map((i) => i.id)).toContain(f.incidentId);

    // incident moved awaiting_merge → verifying
    expect(f.db.dao.incidents.getById(f.incidentId)!.status).toBe('verifying');
    // victim healed exactly once
    expect(healCalls).toBe(1);
    // PR marked merged
    const pr = f.db.dao.pullRequests.getById(f.prId)!;
    expect(pr.state).toBe('merged');
    expect(pr.merged_at).not.toBeNull();
    // merge deploy recorded + current
    const current = f.db.dao.deploys.getCurrent(f.customerId)!;
    expect(current.sha).toBe('merge_sha_abcdef');
    expect(current.source).toBe('merge');
    expect(current.is_current).toBe(true);
    expect(current.pr_id).toBe(f.prId);
    // not resolved yet — sustained window not elapsed
    expect(r1.resolved).toHaveLength(0);
  });

  it('resolves once health is sustained ≥30s and comments recovery on the PR', async () => {
    f = seed();
    const gh = fakeGithub(mergedPull);
    const clock = new ManualClock(T0);
    let healCalls = 0;
    const poller = new MergePoller({
      db: f.db,
      config: f.config,
      octokit: gh.octokit,
      clock,
      healer: { heal: async () => void healCalls++ },
      sampleRollup: () => healthyRollup(),
    });

    await poller.poll(); // T0 — merge detected, verifying, firstHealthyAt = T0
    expect(f.db.dao.incidents.getById(f.incidentId)!.status).toBe('verifying');

    clock.advance(RECOVERY_SUSTAIN_MS); // T0 + 30s — sustained health
    const r2 = await poller.poll();

    const inc = f.db.dao.incidents.getById(f.incidentId)!;
    expect(inc.status).toBe('resolved');
    expect(inc.resolved_at).not.toBeNull();
    expect(r2.resolved.map((i) => i.id)).toContain(f.incidentId);

    // PR verification recorded + comment posted
    const pr = f.db.dao.pullRequests.getById(f.prId)!;
    expect(pr.verification_status).toBe('recovered');
    expect(pr.verification_comment_id).toBe(999);
    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0].issue_number).toBe(7);
    expect(gh.comments[0].body).toContain('Recovery confirmed');

    // heal fired only on the merge poll, not again on the recovery poll
    expect(healCalls).toBe(1);
  });
});

describe('merge → verifying → not_recovered (recovery fails)', () => {
  it('re-escalates and comments not-recovered when health never returns', async () => {
    f = seed();
    const gh = fakeGithub(mergedPull);
    const clock = new ManualClock(T0);
    const poller = new MergePoller({
      db: f.db,
      config: f.config,
      octokit: gh.octokit,
      clock,
      healer: { heal: async () => {} },
      sampleRollup: () => unhealthyRollup(),
    });

    await poller.poll(); // T0 — verifying, unhealthy
    clock.advance(f.config.detection.recoveryWindowMs); // window expires
    const r2 = await poller.poll();

    const inc = f.db.dao.incidents.getById(f.incidentId)!;
    expect(inc.status).toBe('escalated');
    expect(r2.escalated.map((i) => i.id)).toContain(f.incidentId);

    const pr = f.db.dao.pullRequests.getById(f.prId)!;
    expect(pr.verification_status).toBe('not_recovered');
    expect(gh.comments[0].body).toContain('not confirmed');
  });
});

describe('unmerged PRs are left alone', () => {
  it('does not heal or transition while the PR is still open', async () => {
    f = seed();
    const openPull: MergePollerPull = { merged: false, merged_at: null, merge_commit_sha: null, state: 'open' };
    const gh = fakeGithub(openPull);
    let healCalls = 0;
    const poller = new MergePoller({
      db: f.db,
      config: f.config,
      octokit: gh.octokit,
      clock: new ManualClock(T0),
      healer: { heal: async () => void healCalls++ },
      sampleRollup: () => healthyRollup(),
    });

    const r = await poller.poll();
    expect(healCalls).toBe(0);
    expect(r.merged).toHaveLength(0);
    expect(f.db.dao.incidents.getById(f.incidentId)!.status).toBe('awaiting_merge');
    expect(f.db.dao.pullRequests.getById(f.prId)!.state).toBe('open');
  });

  it('marks a PR closed-without-merge and leaves the incident for humans', async () => {
    f = seed();
    const closedPull: MergePollerPull = { merged: false, merged_at: null, merge_commit_sha: null, state: 'closed' };
    const gh = fakeGithub(closedPull);
    let healCalls = 0;
    const poller = new MergePoller({
      db: f.db,
      config: f.config,
      octokit: gh.octokit,
      clock: new ManualClock(T0),
      healer: { heal: async () => void healCalls++ },
      sampleRollup: () => healthyRollup(),
    });

    await poller.poll();
    expect(healCalls).toBe(0);
    expect(f.db.dao.pullRequests.getById(f.prId)!.state).toBe('closed');
    expect(f.db.dao.incidents.getById(f.incidentId)!.status).toBe('awaiting_merge');
  });
});
