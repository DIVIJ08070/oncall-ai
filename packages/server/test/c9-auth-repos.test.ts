import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openMemoryDatabase, type OncallDb } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createBroker } from '../src/sse/broker.js';
import type { GithubGateway } from '../src/github/gateway.js';

/**
 * C9 — GitHub OAuth + repo onboarding + integration snippet (SPEC §7.5, §7.6).
 * Exercised via Fastify `.inject()` with a fake `GithubGateway` (no network) and
 * manual signed-cookie round-tripping (no `@fastify/cookie`).
 */

const KEY = 'c9-ingest-key';
const PAT = 'ghp_platform_pat';

function fakeGateway(over: Partial<GithubGateway> = {}): GithubGateway {
  return {
    oauthConfigured: true,
    authorizeUrl: (state) =>
      `https://github.com/login/oauth/authorize?client_id=cid&state=${state}`,
    exchangeCode: async () => ({ accessToken: 'gho_user_token' }),
    getUser: async () => ({ id: 42, login: 'octocat', avatar_url: 'https://x/av.png' }),
    listRepos: async () => [
      { owner: 'octocat', repo: 'hello', default_branch: 'main', private: false, permissions: { push: true } },
      { owner: 'octocat', repo: 'readonly', default_branch: 'main', private: true, permissions: { push: false, pull: true } },
    ],
    getRepo: async (_t, owner, repo) => ({
      owner,
      repo,
      default_branch: 'main',
      private: false,
      permissions: { push: repo !== 'readonly' },
    }),
    ...over,
  };
}

interface Ctx {
  app: FastifyInstance;
  db: OncallDb;
  customerId: string;
}

function build(
  envOver: Record<string, string> = {},
  gateway: GithubGateway = fakeGateway(),
): Promise<Ctx> {
  const db = openMemoryDatabase();
  const customer = db.dao.customers.create({ name: 'demo', ingest_api_key: KEY });
  const broker = createBroker();
  const config = loadConfig({
    INGEST_API_KEY: KEY,
    SESSION_SECRET: 'test-secret',
    GITHUB_TOKEN: PAT,
    DASHBOARD_URL: 'http://localhost:5173',
    PUBLIC_BASE_URL: 'http://localhost:3001',
    ...envOver,
  });
  return buildApp({ config, db, broker, github: gateway }).then((app) => ({
    app,
    db,
    customerId: customer.id,
  }));
}

let ctx: Ctx;
afterEach(async () => {
  if (ctx) {
    await ctx.app.close();
    ctx.db.close();
  }
});

/** Extract a raw cookie value (as the browser would echo it) from res.cookies. */
function cookie(res: { cookies: Array<{ name: string; value: string }> }, name: string) {
  return res.cookies.find((c) => c.name === name)?.value;
}

// ── A. OAuth login ─────────────────────────────────────────────────────────
describe('A. GET /auth/github/login', () => {
  it('302s to GitHub authorize and sets a signed state cookie', async () => {
    ctx = await build();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/github/login' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('github.com/login/oauth/authorize');
    const state = cookie(res, 'oncall_oauth_state');
    expect(state).toBeTruthy();
    // signed → value.signature
    expect(state).toContain('.');
  });

  it('503s when OAuth is not configured', async () => {
    ctx = await build({}, fakeGateway({ oauthConfigured: false }));
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/github/login' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('upstream_error');
  });
});

// ── B. OAuth callback ──────────────────────────────────────────────────────
describe('B. GET /auth/github/callback', () => {
  async function login() {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/github/login' });
    const stateCookie = cookie(res, 'oncall_oauth_state')!;
    const loc = new URL(res.headers.location as string);
    const state = loc.searchParams.get('state')!;
    return { stateCookie, state };
  }

  it('exchanges code, upserts user linked to the seed customer, sets session, 302s to dashboard', async () => {
    ctx = await build();
    const { stateCookie, state } = await login();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/auth/github/callback?code=abc&state=${state}`,
      cookies: { oncall_oauth_state: stateCookie },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/onboarding');
    expect(cookie(res, 'oncall_session')).toBeTruthy();

    const user = ctx.db.dao.users.getByGithubUserId(42);
    expect(user).not.toBeNull();
    expect(user!.github_login).toBe('octocat');
    expect(user!.access_token).toBe('gho_user_token');
    expect(user!.customer_id).toBe(ctx.customerId);
  });

  it('rejects a state mismatch (CSRF) with 401', async () => {
    ctx = await build();
    const { stateCookie } = await login();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/auth/github/callback?code=abc&state=not-the-state`,
      cookies: { oncall_oauth_state: stateCookie },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
    expect(ctx.db.dao.users.getByGithubUserId(42)).toBeNull();
  });

  it('400s when code/state are missing', async () => {
    ctx = await build();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/auth/github/callback`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});

// ── C. auth/me + logout ────────────────────────────────────────────────────
describe('C. /auth/me + /auth/logout', () => {
  async function authenticate() {
    const loginRes = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/github/login' });
    const stateCookie = cookie(loginRes, 'oncall_oauth_state')!;
    const state = new URL(loginRes.headers.location as string).searchParams.get('state')!;
    const cbRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/auth/github/callback?code=abc&state=${state}`,
      cookies: { oncall_oauth_state: stateCookie },
    });
    return cookie(cbRes, 'oncall_session')!;
  }

  it('401s without a session', async () => {
    ctx = await build();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('returns the user with a valid session', async () => {
    ctx = await build();
    const session = await authenticate();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { oncall_session: session },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ github_login: 'octocat', avatar_url: 'https://x/av.png' });
    expect(res.json().user.id).toMatch(/^usr_/);
  });

  it('rejects a tampered session cookie (bad signature) with 401', async () => {
    ctx = await build();
    const session = await authenticate();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { oncall_session: session + 'x' }, // corrupt the signature
    });
    expect(res.statusCode).toBe(401);
  });

  it('logout → 204', async () => {
    ctx = await build();
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(res.statusCode).toBe(204);
  });
});

// ── D. repos list/select (DEV_NO_AUTH → platform PAT) ──────────────────────
describe('D. /repos (DEV_NO_AUTH PAT fallback)', () => {
  it('GET /repos lists repos via the PAT under DEV_NO_AUTH', async () => {
    ctx = await build({ DEV_NO_AUTH: 'true' });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/repos' });
    expect(res.statusCode).toBe(200);
    const { repos } = res.json();
    expect(repos).toHaveLength(2);
    expect(repos[0]).toEqual({ owner: 'octocat', repo: 'hello', default_branch: 'main', private: false });
  });

  it('GET /repos 401s without a session and without DEV_NO_AUTH/PAT', async () => {
    ctx = await build({ DEV_NO_AUTH: 'false', GITHUB_TOKEN: '' });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/repos' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /repos/select binds the customer when the repo is writable', async () => {
    ctx = await build({ DEV_NO_AUTH: 'true' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/repos/select',
      payload: { owner: 'octocat', repo: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().customer).toMatchObject({
      github_owner: 'octocat',
      github_repo: 'hello',
      default_branch: 'main',
    });
    const c = ctx.db.dao.customers.getById(ctx.customerId);
    expect(c!.github_owner).toBe('octocat');
    expect(c!.github_repo).toBe('hello');
  });

  it('POST /repos/select 422s when Contents/PRs write is absent', async () => {
    ctx = await build({ DEV_NO_AUTH: 'true' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/repos/select',
      payload: { owner: 'octocat', repo: 'readonly' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    // customer must NOT be bound to a repo it can't write
    expect(ctx.db.dao.customers.getById(ctx.customerId)!.github_owner).toBeNull();
  });

  it('POST /repos/select 400s on an invalid body', async () => {
    ctx = await build({ DEV_NO_AUTH: 'true' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/repos/select',
      payload: { owner: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});

// ── E. integration snippet (§7.6) ──────────────────────────────────────────
describe('E. GET /integration-snippet', () => {
  it('returns the ingest url/key + ready-to-paste snippets', async () => {
    ctx = await build({ DEV_NO_AUTH: 'true' });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/integration-snippet' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ingest_url).toBe('http://localhost:3001/api/v1/ingest');
    expect(body.ingest_api_key).toBe(KEY);
    expect(body.middleware_snippet).toContain("oncall({ apiKey: '" + KEY + "'");
    expect(body.middleware_snippet).toContain("@oncall/sdk");
    expect(body.tailer_snippet).toContain('oncall-tail');
    expect(body.tailer_snippet).toContain(KEY);
    expect(Object.keys(body).sort()).toEqual([
      'ingest_api_key',
      'ingest_url',
      'middleware_snippet',
      'tailer_snippet',
    ]);
  });
});
