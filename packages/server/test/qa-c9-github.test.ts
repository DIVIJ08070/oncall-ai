import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { openMemoryDatabase, type OncallDb } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createBroker } from '../src/sse/broker.js';
import { createGithubGateway, type GithubGateway } from '../src/github/gateway.js';
import { ManualClock } from '../src/detection/clock.js';
import { emptyRollup, type Rollup } from '../src/metrics/rollup.js';
import {
  MergePoller,
  createVictimHealer,
  type MergePollerOctokit,
  type MergePollerPull,
  type VictimHealer,
} from '../src/github/merge-poller.js';

/**
 * QA C9 — INDEPENDENT spec-derived suite (SPEC §7.5/§7.6/§7.7/§10.4/§10.5,
 * FR-12/FR-15/NFR-03). Written from the SPEC contract BEFORE trusting the impl;
 * not copied from the developer's c9-*.test.ts. Deliberately closes gaps the dev
 * suite left open: the REAL gateway's authorize-URL scope, REAL-gateway
 * empty-creds graceful degradation, the recovery relapse-reset, and a RUNTIME
 * NFR-03 no-merge/force-verb spy on the poller's Octokit surface.
 *
 * OAuth creds are intentionally empty in the real .env (MAPPING) — live-GitHub
 * OAuth QA is deferred. Everything here is mocked/injected: no network, no
 * wall-clock, no real merge.
 */

const KEY = 'qa-c9-ingest-key';
const PAT = 'ghp_platform_pat_qa';
const T0 = 1_700_000_000_000;
const SUSTAIN_MS = 30_000; // SPEC §10.5 "sustained ≥ 30s"

/* ─────────────────────────────  OAuth / repos via .inject()  ───────────────── */

function fakeGateway(over: Partial<GithubGateway> = {}): GithubGateway {
  return {
    oauthConfigured: true,
    authorizeUrl: (state) =>
      `https://github.com/login/oauth/authorize?client_id=cid&scope=repo+read%3Auser&state=${state}`,
    exchangeCode: async () => ({ accessToken: 'gho_user_token' }),
    getUser: async () => ({ id: 4242, login: 'qacat', avatar_url: 'https://x/av.png' }),
    listRepos: async () => [
      { owner: 'qacat', repo: 'writable', default_branch: 'main', private: false, permissions: { push: true } },
      { owner: 'qacat', repo: 'readonly', default_branch: 'dev', private: true, permissions: { push: false, pull: true } },
    ],
    getRepo: async (_t, owner, repo) => {
      if (repo === 'ghost') {
        throw Object.assign(new Error('Not Found'), { status: 404 });
      }
      return {
        owner,
        repo,
        default_branch: repo === 'writable' ? 'main' : 'dev',
        private: false,
        permissions: { push: repo === 'writable' },
      };
    },
    ...over,
  };
}

interface AppCtx {
  app: FastifyInstance;
  db: OncallDb;
  customerId: string;
  config: Config;
}

async function buildAppCtx(
  envOver: Record<string, string> = {},
  gateway: GithubGateway = fakeGateway(),
): Promise<AppCtx> {
  const db = openMemoryDatabase();
  const customer = db.dao.customers.create({ name: 'demo', ingest_api_key: KEY });
  const broker = createBroker();
  const config = loadConfig({
    INGEST_API_KEY: KEY,
    SESSION_SECRET: 'qa-secret',
    GITHUB_TOKEN: PAT,
    DASHBOARD_URL: 'http://localhost:5173',
    PUBLIC_BASE_URL: 'http://localhost:3001',
    ...envOver,
  });
  const app = await buildApp({ config, db, broker, github: gateway });
  return { app, db, customerId: customer.id, config };
}

function cookieVal(res: { cookies: Array<{ name: string; value: string }> }, name: string) {
  return res.cookies.find((c) => c.name === name)?.value;
}

let appCtx: AppCtx | undefined;
afterEach(async () => {
  if (appCtx) {
    await appCtx.app.close();
    appCtx.db.close();
    appCtx = undefined;
  }
  vi.restoreAllMocks();
});

/* ── A. OAuth (mocked) ─────────────────────────────────────────────────────── */

describe('C9-A OAuth login/callback/me/logout (SPEC §7.5)', () => {
  it('TC-01 login 302s to GitHub authorize and sets a signed state cookie tied to the URL state', async () => {
    appCtx = await buildAppCtx();
    const res = await appCtx.app.inject({ method: 'GET', url: '/api/v1/auth/github/login' });
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.origin + loc.pathname).toBe('https://github.com/login/oauth/authorize');
    const urlState = loc.searchParams.get('state');
    expect(urlState).toBeTruthy();
    const stateCookie = cookieVal(res, 'oncall_oauth_state');
    expect(stateCookie).toBeTruthy();
    expect(stateCookie).toContain('.'); // signed value.signature
    // the signed cookie's plaintext must equal the URL state (CSRF binding)
    expect(decodeURIComponent(stateCookie!).split('.')[0]).toBe(urlState);
  });

  it('TC-01b the REAL gateway builds the correct authorize URL (scope repo read:user, client_id, redirect_uri)', () => {
    const cfg = loadConfig({
      GITHUB_OAUTH_CLIENT_ID: 'cid123',
      GITHUB_OAUTH_CLIENT_SECRET: 'secret456',
      PUBLIC_BASE_URL: 'http://localhost:3001',
    });
    const gw = createGithubGateway(cfg);
    expect(gw.oauthConfigured).toBe(true);
    const url = new URL(gw.authorizeUrl('st8'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid123');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3001/api/v1/auth/github/callback',
    );
    expect(url.searchParams.get('scope')).toBe('repo read:user');
    expect(url.searchParams.get('state')).toBe('st8');
  });

  it('TC-03 callback validates state, exchanges code (mock), upserts users + signed session, 302 to dashboard/onboarding', async () => {
    appCtx = await buildAppCtx();
    const login = await appCtx.app.inject({ method: 'GET', url: '/api/v1/auth/github/login' });
    const stateCookie = cookieVal(login, 'oncall_oauth_state')!;
    const state = new URL(login.headers.location as string).searchParams.get('state')!;

    const cb = await appCtx.app.inject({
      method: 'GET',
      url: `/api/v1/auth/github/callback?code=abc&state=${state}`,
      cookies: { oncall_oauth_state: stateCookie },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('http://localhost:5173/onboarding');
    expect(cookieVal(cb, 'oncall_session')).toBeTruthy();

    const user = appCtx.db.dao.users.getByGithubUserId(4242);
    expect(user).not.toBeNull();
    expect(user!.github_login).toBe('qacat');
    expect(user!.access_token).toBe('gho_user_token');
    expect(user!.customer_id).toBe(appCtx.customerId); // linked to seed customer
  });

  it('TC-02 callback with a MISMATCHED state does NOT upsert a user or set a session (CSRF guard)', async () => {
    appCtx = await buildAppCtx();
    const login = await appCtx.app.inject({ method: 'GET', url: '/api/v1/auth/github/login' });
    const stateCookie = cookieVal(login, 'oncall_oauth_state')!;
    const res = await appCtx.app.inject({
      method: 'GET',
      url: `/api/v1/auth/github/callback?code=abc&state=TOTALLY-WRONG`,
      cookies: { oncall_oauth_state: stateCookie },
    });
    expect(res.statusCode).toBe(401);
    expect(cookieVal(res, 'oncall_session')).toBeFalsy();
    expect(appCtx.db.dao.users.getByGithubUserId(4242)).toBeNull();
  });

  it('TC-04 me returns 200 {user} with a valid session', async () => {
    appCtx = await buildAppCtx();
    const login = await appCtx.app.inject({ method: 'GET', url: '/api/v1/auth/github/login' });
    const stateCookie = cookieVal(login, 'oncall_oauth_state')!;
    const state = new URL(login.headers.location as string).searchParams.get('state')!;
    const cb = await appCtx.app.inject({
      method: 'GET',
      url: `/api/v1/auth/github/callback?code=abc&state=${state}`,
      cookies: { oncall_oauth_state: stateCookie },
    });
    const session = cookieVal(cb, 'oncall_session')!;

    const me = await appCtx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { oncall_session: session },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ github_login: 'qacat' });
    expect(me.json().user.id).toMatch(/^usr_/);
  });

  it('TC-05 me returns 401 with no cookie, and with a tampered (bad-signature) session cookie', async () => {
    appCtx = await buildAppCtx();
    const none = await appCtx.app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(none.statusCode).toBe(401);

    // forge: usr_ id with a garbage signature must NOT authenticate
    const forged = await appCtx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { oncall_session: 'usr_forged.deadbeef' },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('TC-06 logout returns 204', async () => {
    appCtx = await buildAppCtx();
    const res = await appCtx.app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(res.statusCode).toBe(204);
  });
});

/* ── B. Graceful degradation — EMPTY OAuth creds (real gateway) ────────────── */

describe('C9-B graceful degradation with EMPTY OAuth creds (MAPPING creds; real gateway)', () => {
  it('TC-07/08/09 empty creds → login/callback 503 while server boots + read paths stay open', async () => {
    // Build with the REAL gateway (empty oauth creds → oauthConfigured=false),
    // DEV_NO_AUTH on. integration-snippet + auth/me/logout touch NO network.
    const db = openMemoryDatabase();
    db.dao.customers.create({ name: 'demo', ingest_api_key: KEY });
    const config = loadConfig({
      INGEST_API_KEY: KEY,
      SESSION_SECRET: 'qa-secret',
      GITHUB_TOKEN: PAT,
      DEV_NO_AUTH: 'true',
      GITHUB_OAUTH_CLIENT_ID: '',
      GITHUB_OAUTH_CLIENT_SECRET: '',
      PUBLIC_BASE_URL: 'http://localhost:3001',
    });
    expect(createGithubGateway(config).oauthConfigured).toBe(false);
    const app = await buildApp({ config, db, broker: createBroker(), github: createGithubGateway(config) });
    try {
      const login = await app.inject({ method: 'GET', url: '/api/v1/auth/github/login' });
      expect(login.statusCode).toBe(503); // gated, not crashed
      const cb = await app.inject({ method: 'GET', url: '/api/v1/auth/github/callback?code=&state=' });
      expect(cb.statusCode).toBe(503);

      // read paths stay open (server booted, gate only touches login/callback)
      const snippet = await app.inject({ method: 'GET', url: '/api/v1/integration-snippet' });
      expect(snippet.statusCode).toBe(200);
      const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(me.statusCode).toBe(401);
      const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
      expect(logout.statusCode).toBe(204);
      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
    } finally {
      await app.close();
      db.close();
    }
  });

  it('TC-09b /repos stays open under DEV_NO_AUTH even when OAuth is unconfigured', async () => {
    appCtx = await buildAppCtx(
      { DEV_NO_AUTH: 'true' },
      fakeGateway({ oauthConfigured: false }),
    );
    const res = await appCtx.app.inject({ method: 'GET', url: '/api/v1/repos' });
    expect(res.statusCode).toBe(200);
  });
});

/* ── C. Repos list/select (SPEC §7.5) ──────────────────────────────────────── */

describe('C9-C repos list/select (SPEC §7.5)', () => {
  it('TC-10 GET /repos returns exactly {owner,repo,default_branch,private} per repo', async () => {
    appCtx = await buildAppCtx({ DEV_NO_AUTH: 'true' });
    const res = await appCtx.app.inject({ method: 'GET', url: '/api/v1/repos' });
    expect(res.statusCode).toBe(200);
    const { repos } = res.json();
    expect(Array.isArray(repos)).toBe(true);
    expect(repos.length).toBe(2);
    for (const r of repos) {
      expect(Object.keys(r).sort()).toEqual(['default_branch', 'owner', 'private', 'repo']);
      expect(typeof r.owner).toBe('string');
      expect(typeof r.repo).toBe('string');
      expect(typeof r.default_branch).toBe('string');
      expect(typeof r.private).toBe('boolean');
    }
  });

  it('TC-11 POST /repos/select binds customer.github_owner/repo/default_branch when writable', async () => {
    appCtx = await buildAppCtx({ DEV_NO_AUTH: 'true' });
    const res = await appCtx.app.inject({
      method: 'POST',
      url: '/api/v1/repos/select',
      payload: { owner: 'qacat', repo: 'writable' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().customer).toMatchObject({
      github_owner: 'qacat',
      github_repo: 'writable',
      default_branch: 'main',
    });
    const c = appCtx.db.dao.customers.getById(appCtx.customerId)!;
    expect(c.github_owner).toBe('qacat');
    expect(c.github_repo).toBe('writable');
    expect(c.default_branch).toBe('main');
  });

  it('TC-12 POST /repos/select 422 when the token lacks PR/Contents write (no push); customer NOT bound', async () => {
    appCtx = await buildAppCtx({ DEV_NO_AUTH: 'true' });
    const res = await appCtx.app.inject({
      method: 'POST',
      url: '/api/v1/repos/select',
      payload: { owner: 'qacat', repo: 'readonly' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    expect(appCtx.db.dao.customers.getById(appCtx.customerId)!.github_owner).toBeNull();
  });

  it('TC-13 POST /repos/select on an unknown repo → 404, no mutation', async () => {
    appCtx = await buildAppCtx({ DEV_NO_AUTH: 'true' });
    const res = await appCtx.app.inject({
      method: 'POST',
      url: '/api/v1/repos/select',
      payload: { owner: 'qacat', repo: 'ghost' },
    });
    expect(res.statusCode).toBe(404);
    expect(appCtx.db.dao.customers.getById(appCtx.customerId)!.github_owner).toBeNull();
  });

  it('TC-14 POST /repos/select with a missing owner/repo → 400 validation_error', async () => {
    appCtx = await buildAppCtx({ DEV_NO_AUTH: 'true' });
    const res = await appCtx.app.inject({
      method: 'POST',
      url: '/api/v1/repos/select',
      payload: { owner: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('TC-10b GET /repos 401s without session/DEV_NO_AUTH/PAT', async () => {
    appCtx = await buildAppCtx({ DEV_NO_AUTH: 'false', GITHUB_TOKEN: '' });
    const res = await appCtx.app.inject({ method: 'GET', url: '/api/v1/repos' });
    expect(res.statusCode).toBe(401);
  });
});

/* ── D. Integration snippet (SPEC §7.6) ────────────────────────────────────── */

describe('C9-D integration snippet (SPEC §7.6)', () => {
  it('TC-15 returns exactly the §7.6 shape with the calling customer ingest key', async () => {
    appCtx = await buildAppCtx({ DEV_NO_AUTH: 'true' });
    const res = await appCtx.app.inject({ method: 'GET', url: '/api/v1/integration-snippet' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual([
      'ingest_api_key',
      'ingest_url',
      'middleware_snippet',
      'tailer_snippet',
    ]);
    expect(body.ingest_url).toBe('http://localhost:3001/api/v1/ingest');
    expect(body.ingest_api_key).toBe(KEY); // seed customer's own key
    expect(body.middleware_snippet).toContain('@oncall/sdk');
    expect(body.middleware_snippet).toContain(KEY);
    expect(body.tailer_snippet).toContain('oncall-tail');
    expect(body.tailer_snippet).toContain(KEY);
  });
});

/* ─────────────────────  Merge poller + recovery verifier  ──────────────────── */

function healthyRollup(): Rollup {
  return { ...emptyRollup(), request_count: 40, raw_request_count: 40, p50_ms: 20, p95_ms: 90, p99_ms: 150 };
}
function unhealthyRollup(): Rollup {
  return { ...emptyRollup(), request_count: 40, raw_request_count: 40, error_count: 40, error_rate: 1, p50_ms: 20, p95_ms: 90, p99_ms: 150 };
}

interface Spy {
  octokit: MergePollerOctokit;
  comments: Array<{ issue_number: number; body: string }>;
  pullsGet: number;
  mergeCalls: number;
  updateRefCalls: number;
  deleteRefCalls: number;
}

/**
 * A fake Octokit that ALSO exposes forbidden write verbs (pulls.merge,
 * git.updateRef/deleteRef) as spies — so NFR-03 can be asserted at RUNTIME:
 * a full merge→resolve and merge→escalate cycle must never touch them.
 */
function spyOctokit(pull: MergePollerPull): Spy {
  const s: Spy = {
    comments: [],
    pullsGet: 0,
    mergeCalls: 0,
    updateRefCalls: 0,
    deleteRefCalls: 0,
    octokit: undefined as unknown as MergePollerOctokit,
  };
  s.octokit = {
    rest: {
      pulls: {
        get: async () => {
          s.pullsGet++;
          return { data: pull };
        },
        // forbidden — must never be called (cast keeps it off the typed surface)
        merge: async () => {
          s.mergeCalls++;
          return { data: { merged: true } };
        },
      },
      issues: {
        createComment: async (p) => {
          s.comments.push({ issue_number: p.issue_number, body: p.body });
          return { data: { id: 555 } };
        },
      },
      repos: {
        getCommit: async () => ({
          data: {
            sha: 'mergesha0123456',
            commit: { message: 'Merge #7 revert\n\nbody', author: { name: 'qa', date: new Date(T0).toISOString() } },
            author: { login: 'qacat' },
          },
        }),
      },
      git: {
        updateRef: async () => {
          s.updateRefCalls++;
          return { data: {} };
        },
        deleteRef: async () => {
          s.deleteRefCalls++;
          return { data: {} };
        },
      },
    },
  } as unknown as MergePollerOctokit;
  return s;
}

interface PollFixture {
  db: OncallDb;
  config: Config;
  customerId: string;
  incidentId: string;
  prId: string;
}

function seedAwaitingMerge(envOver: Record<string, string> = {}): PollFixture {
  const db = openMemoryDatabase();
  const config = loadConfig({ GITHUB_OWNER: 'DIVIJ08070', GITHUB_REPO: 'oncall-ai-victim', ...envOver });
  const customer = db.dao.customers.create({ name: 'demo', ingest_api_key: 'k' });
  db.dao.services.touch(customer.id, 'checkout-api', T0);
  const { incident } = db.dao.incidents.openOrDedup({
    customer_id: customer.id,
    service: 'checkout-api',
    detector: 'error_rate',
    fingerprint: 'fp-qa-1',
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
    diagnostic_report: '## Root Cause',
    head_sha: 'headsha1',
  });
  db.dao.incidents.update(incident.id, { status: 'awaiting_merge', pr_id: pr.id });
  return { db, config, customerId: customer.id, incidentId: incident.id, prId: pr.id };
}

const mergedPull: MergePollerPull = {
  merged: true,
  merged_at: new Date(T0).toISOString(),
  merge_commit_sha: 'mergesha0123456',
  state: 'closed',
};

let pf: PollFixture | undefined;
afterEach(() => {
  if (pf) {
    pf.db.close();
    pf = undefined;
  }
});

describe('C9-E merge poller + recovery verifier (SPEC §10.5, FR-12)', () => {
  it('TC-16/17/18 on merge: records deploys merge row, heals the victim once, drives incident→verifying', async () => {
    pf = seedAwaitingMerge();
    const spy = spyOctokit(mergedPull);
    let healCalls = 0;
    const healer: VictimHealer = { heal: async () => void healCalls++ };
    const poller = new MergePoller({
      db: pf.db,
      config: pf.config,
      octokit: spy.octokit,
      clock: new ManualClock(T0),
      healer,
      sampleRollup: () => healthyRollup(),
    });

    const r = await poller.poll();
    expect(r.merged.map((i) => i.id)).toContain(pf.incidentId);

    // TC-18: verifying
    expect(pf.db.dao.incidents.getById(pf.incidentId)!.status).toBe('verifying');
    // TC-17: healed exactly once
    expect(healCalls).toBe(1);
    // TC-16: deploys merge row is current
    const dep = pf.db.dao.deploys.getCurrent(pf.customerId)!;
    expect(dep.sha).toBe('mergesha0123456');
    expect(dep.source).toBe('merge');
    expect(dep.is_current).toBe(true);
    expect(dep.pr_id).toBe(pf.prId);
    // PR marked merged
    expect(pf.db.dao.pullRequests.getById(pf.prId)!.state).toBe('merged');
  });

  it('TC-19/20 sustained ≥30s recovery → resolved + PR "Recovery confirmed" comment + verification_status=recovered', async () => {
    pf = seedAwaitingMerge();
    const spy = spyOctokit(mergedPull);
    const clock = new ManualClock(T0);
    const poller = new MergePoller({
      db: pf.db,
      config: pf.config,
      octokit: spy.octokit,
      clock,
      healer: { heal: async () => {} },
      sampleRollup: () => healthyRollup(),
    });

    await poller.poll(); // T0 merge → verifying, firstHealthyAt=T0
    clock.advance(SUSTAIN_MS); // T0+30s sustained
    const r = await poller.poll();

    const inc = pf.db.dao.incidents.getById(pf.incidentId)!;
    expect(inc.status).toBe('resolved');
    expect(inc.resolved_at).not.toBeNull();
    expect(r.resolved.map((i) => i.id)).toContain(pf.incidentId);

    const pr = pf.db.dao.pullRequests.getById(pf.prId)!;
    expect(pr.verification_status).toBe('recovered');
    expect(pr.verification_comment_id).toBe(555);
    expect(spy.comments).toHaveLength(1);
    expect(spy.comments[0].issue_number).toBe(7);
    expect(spy.comments[0].body).toContain('Recovery confirmed');
  });

  it('TC-21 window expiry with no recovery → re-escalated + not_recovered comment + verification_status=not_recovered', async () => {
    pf = seedAwaitingMerge();
    const spy = spyOctokit(mergedPull);
    const clock = new ManualClock(T0);
    const poller = new MergePoller({
      db: pf.db,
      config: pf.config,
      octokit: spy.octokit,
      clock,
      healer: { heal: async () => {} },
      sampleRollup: () => unhealthyRollup(),
    });

    await poller.poll(); // T0 merge → verifying, unhealthy
    clock.advance(pf.config.detection.recoveryWindowMs); // window expires
    const r = await poller.poll();

    const inc = pf.db.dao.incidents.getById(pf.incidentId)!;
    expect(inc.status).toBe('escalated');
    expect(r.escalated.map((i) => i.id)).toContain(pf.incidentId);
    const pr = pf.db.dao.pullRequests.getById(pf.prId)!;
    expect(pr.verification_status).toBe('not_recovered');
    expect(spy.comments[0].body).toMatch(/not confirmed|re-escalated/i);
  });

  it('TC-22 a relapse RESETS the sustained-health clock (does not resolve at the original +30s)', async () => {
    // Widen the window so the tie between sustain-end and window-expiry can't confound.
    pf = seedAwaitingMerge({ RECOVERY_WINDOW_MS: '120000' });
    const spy = spyOctokit(mergedPull);
    const clock = new ManualClock(T0);
    let roll: Rollup = healthyRollup();
    const poller = new MergePoller({
      db: pf.db,
      config: pf.config,
      octokit: spy.octokit,
      clock,
      healer: { heal: async () => {} },
      sampleRollup: () => roll,
    });

    await poller.poll(); // T0 merge → verifying, firstHealthyAt=T0
    clock.advance(20_000); // T0+20 healthy
    await poller.poll();
    roll = unhealthyRollup();
    clock.advance(5_000); // T0+25 relapse → firstHealthyAt reset
    await poller.poll();
    roll = healthyRollup();
    clock.advance(5_000); // T0+30 (== original +30) but clock was reset at T0+25
    await poller.poll();
    // WITHOUT the reset this would already be resolved; with it, still verifying.
    expect(pf.db.dao.incidents.getById(pf.incidentId)!.status).toBe('verifying');

    clock.advance(30_000); // T0+60: firstHealthyAt=T0+30 → 30s sustained
    await poller.poll();
    expect(pf.db.dao.incidents.getById(pf.incidentId)!.status).toBe('resolved');
  });

  it('TC-23 an unmerged (still-open) PR is left alone: no deploy, no heal, no transition', async () => {
    pf = seedAwaitingMerge();
    const openPull: MergePollerPull = { merged: false, merged_at: null, merge_commit_sha: null, state: 'open' };
    const spy = spyOctokit(openPull);
    let healCalls = 0;
    const poller = new MergePoller({
      db: pf.db,
      config: pf.config,
      octokit: spy.octokit,
      clock: new ManualClock(T0),
      healer: { heal: async () => void healCalls++ },
      sampleRollup: () => healthyRollup(),
    });
    const r = await poller.poll();
    expect(healCalls).toBe(0);
    expect(r.merged).toHaveLength(0);
    expect(pf.db.dao.incidents.getById(pf.incidentId)!.status).toBe('awaiting_merge');
    expect(pf.db.dao.deploys.getCurrent(pf.customerId)).toBeNull();
  });

  it('TC-24 a closed-without-merge PR is marked closed and the incident is left for humans', async () => {
    pf = seedAwaitingMerge();
    const closedPull: MergePollerPull = { merged: false, merged_at: null, merge_commit_sha: null, state: 'closed' };
    const spy = spyOctokit(closedPull);
    let healCalls = 0;
    const poller = new MergePoller({
      db: pf.db,
      config: pf.config,
      octokit: spy.octokit,
      clock: new ManualClock(T0),
      healer: { heal: async () => void healCalls++ },
      sampleRollup: () => healthyRollup(),
    });
    await poller.poll();
    expect(healCalls).toBe(0);
    expect(pf.db.dao.pullRequests.getById(pf.prId)!.state).toBe('closed');
    expect(pf.db.dao.incidents.getById(pf.incidentId)!.status).toBe('awaiting_merge');
  });

  it('TC-25 NFR-03 (runtime): a full recovered + escalated cycle NEVER calls pulls.merge / git.updateRef / git.deleteRef', async () => {
    // recovered cycle
    pf = seedAwaitingMerge();
    const spyOk = spyOctokit(mergedPull);
    const clock = new ManualClock(T0);
    const p1 = new MergePoller({
      db: pf.db, config: pf.config, octokit: spyOk.octokit, clock,
      healer: { heal: async () => {} }, sampleRollup: () => healthyRollup(),
    });
    await p1.poll();
    clock.advance(SUSTAIN_MS);
    await p1.poll();
    expect(pf.db.dao.incidents.getById(pf.incidentId)!.status).toBe('resolved');
    pf.db.close();

    // escalated cycle
    pf = seedAwaitingMerge();
    const spyBad = spyOctokit(mergedPull);
    const clock2 = new ManualClock(T0);
    const p2 = new MergePoller({
      db: pf.db, config: pf.config, octokit: spyBad.octokit, clock: clock2,
      healer: { heal: async () => {} }, sampleRollup: () => unhealthyRollup(),
    });
    await p2.poll();
    clock2.advance(pf.config.detection.recoveryWindowMs);
    await p2.poll();
    expect(pf.db.dao.incidents.getById(pf.incidentId)!.status).toBe('escalated');

    // NFR-03: no merge/force verb ever touched across BOTH cycles
    expect(spyOk.mergeCalls).toBe(0);
    expect(spyOk.updateRefCalls).toBe(0);
    expect(spyOk.deleteRefCalls).toBe(0);
    expect(spyBad.mergeCalls).toBe(0);
    expect(spyBad.updateRefCalls).toBe(0);
    expect(spyBad.deleteRefCalls).toBe(0);
    // but the allowed read + comment verbs WERE used
    expect(spyOk.pullsGet).toBeGreaterThan(0);
    expect(spyOk.comments.length).toBe(1);
  });

  it('TC-25b NFR-03 (structural): merge-poller.ts source contains no merge/force/updateRef/deleteRef verb', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/github/merge-poller.ts', import.meta.url)),
      'utf8',
    );
    // strip line comments so prose ("never merges") can't trip the check
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/pulls\.merge/);
    expect(code).not.toMatch(/\.updateRef\b/);
    expect(code).not.toMatch(/\.deleteRef\b/);
    expect(code).not.toMatch(/force\s*:/);
  });
});

/* ── F. Default victim healer targets the right endpoint (SPEC §10.5 step 2) ── */

describe('C9-F default victim healer (SPEC §10.5 step 2)', () => {
  it('TC-17b createVictimHealer POSTs victim /__control/failure-mode {mode:"healthy"}', async () => {
    const config = loadConfig({ VICTIM_CONTROL_URL: 'http://localhost:4000' });
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: any, init: any) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response('{"mode":"healthy"}', { status: 200 });
      });
    await createVictimHealer(config).heal();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(calls[0].url).toBe('http://localhost:4000/__control/failure-mode');
    expect(calls[0].body).toEqual({ mode: 'healthy' });
  });
});
