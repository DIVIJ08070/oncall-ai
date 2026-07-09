import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { GithubGateway } from '../github/gateway.js';
import {
  SESSION_COOKIE,
  clearSession,
  clearStateCookie,
  currentUser,
  issueSession,
  readStateCookie,
  setStateCookie,
} from '../github/session.js';
import { readSignedCookie } from '../http/cookies.js';
import { sendError } from '../http/errors.js';

/**
 * GitHub OAuth routes (SPEC §7.5, FR-15).
 *
 * - `GET  /api/v1/auth/github/login`    → 302 to GitHub authorize (+ signed state cookie)
 * - `GET  /api/v1/auth/github/callback` → verify state, exchange code, upsert user,
 *                                         issue signed session cookie, 302 to dashboard
 * - `GET  /api/v1/auth/me`              → 200 { user } | 401
 * - `POST /api/v1/auth/logout`          → 204
 *
 * OAuth creds may be empty in `.env` (deferred). The routes still register and the
 * server boots; login/callback return `503 upstream_error` until creds arrive, so
 * `DEV_NO_AUTH` read paths + repo onboarding keep working (SPEC §14, MAPPING creds).
 */

export function registerAuthRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  github: GithubGateway,
): void {
  const { db, config } = ctx;

  app.get('/api/v1/auth/github/login', (req, reply) => {
    if (!github.oauthConfigured) {
      return sendError(
        reply,
        503,
        'upstream_error',
        'GitHub OAuth is not configured (set GITHUB_OAUTH_CLIENT_ID/SECRET). ' +
          'Read APIs remain open under DEV_NO_AUTH.',
      );
    }
    const state = randomBytes(16).toString('hex');
    setStateCookie(reply, state, config);
    return reply.redirect(github.authorizeUrl(state), 302);
  });

  app.get('/api/v1/auth/github/callback', async (req, reply) => {
    if (!github.oauthConfigured) {
      return sendError(
        reply,
        503,
        'upstream_error',
        'GitHub OAuth is not configured (set GITHUB_OAUTH_CLIENT_ID/SECRET).',
      );
    }

    const query = (req.query ?? {}) as { code?: string; state?: string; error?: string };
    if (query.error) {
      return sendError(reply, 401, 'unauthorized', `GitHub OAuth denied: ${query.error}`);
    }
    if (!query.code || !query.state) {
      return sendError(reply, 400, 'validation_error', 'Missing OAuth code/state');
    }

    const expectedState = readStateCookie(req, config);
    if (!expectedState || expectedState !== query.state) {
      clearStateCookie(reply);
      return sendError(reply, 401, 'unauthorized', 'OAuth state mismatch (possible CSRF)');
    }
    clearStateCookie(reply);

    let accessToken: string;
    try {
      ({ accessToken } = await github.exchangeCode(query.code));
    } catch (err) {
      return sendError(
        reply,
        502,
        'upstream_error',
        err instanceof Error ? err.message : 'OAuth token exchange failed',
      );
    }

    let profile;
    try {
      profile = await github.getUser(accessToken);
    } catch (err) {
      return sendError(
        reply,
        502,
        'upstream_error',
        err instanceof Error ? err.message : 'Failed to load GitHub user',
      );
    }

    // Link the user to the seed customer so repo-select has a customer to bind (SPEC §7.5).
    const seed = db.dao.customers.getByIngestKey(config.ingest.apiKey);
    const user = db.dao.users.upsertByGithubUserId({
      github_user_id: profile.id,
      github_login: profile.login,
      avatar_url: profile.avatar_url,
      access_token: accessToken,
      customer_id: seed?.id ?? null,
    });

    issueSession(reply, user.id, config);
    return reply.redirect(`${config.server.dashboardUrl.replace(/\/+$/, '')}/onboarding`, 302);
  });

  app.get('/api/v1/auth/me', (req, reply) => {
    const user = currentUser(req, db, config);
    if (!user) {
      return sendError(reply, 401, 'unauthorized', 'Not authenticated');
    }
    return reply.code(200).send({
      user: {
        id: user.id,
        github_login: user.github_login,
        avatar_url: user.avatar_url,
      },
    });
  });

  app.post('/api/v1/auth/logout', (req, reply) => {
    // Best-effort: only clear when a (valid) session cookie is actually present.
    const hasSession = readSignedCookie(req, SESSION_COOKIE, config.server.sessionSecret);
    if (hasSession) clearSession(reply);
    return reply.code(204).send();
  });
}
