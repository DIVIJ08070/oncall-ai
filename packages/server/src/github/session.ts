import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';
import type { CustomerRow, UserRow } from '../db/rows.js';
import {
  clearCookie,
  readSignedCookie,
  setSignedCookie,
} from '../http/cookies.js';

/**
 * Session + onboarding-context resolution (SPEC §7.5, §6).
 *
 * The signed `oncall_session` cookie carries the `users.id`. Repo-management
 * routes require a session **unless** `DEV_NO_AUTH` is on (SPEC §6/§14 demo
 * bypass) — in that mode we fall back to the seed customer and the platform PAT
 * so onboarding is exercisable before OAuth creds land.
 */

export const SESSION_COOKIE = 'oncall_session';
export const STATE_COOKIE = 'oncall_oauth_state';

/** ~30-day session; 10-min OAuth-state round-trip window. */
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const STATE_MAX_AGE_SEC = 10 * 60;

export function issueSession(reply: FastifyReply, userId: string, config: Config): void {
  setSignedCookie(reply, SESSION_COOKIE, userId, config.server.sessionSecret, {
    maxAgeSec: SESSION_MAX_AGE_SEC,
  });
}

export function setStateCookie(reply: FastifyReply, state: string, config: Config): void {
  setSignedCookie(reply, STATE_COOKIE, state, config.server.sessionSecret, {
    maxAgeSec: STATE_MAX_AGE_SEC,
  });
}

export function readStateCookie(req: FastifyRequest, config: Config): string | null {
  return readSignedCookie(req, STATE_COOKIE, config.server.sessionSecret);
}

export function clearSession(reply: FastifyReply): void {
  clearCookie(reply, SESSION_COOKIE);
}

export function clearStateCookie(reply: FastifyReply): void {
  clearCookie(reply, STATE_COOKIE);
}

/** The logged-in user (from the signed session cookie), or `null`. */
export function currentUser(
  req: FastifyRequest,
  db: OncallDb,
  config: Config,
): UserRow | null {
  const userId = readSignedCookie(req, SESSION_COOKIE, config.server.sessionSecret);
  if (!userId) return null;
  return db.dao.users.getById(userId);
}

/**
 * Resolve the customer a repo-management call operates on: the session user's
 * customer, else (only under `DEV_NO_AUTH`) the seed customer keyed by
 * `INGEST_API_KEY`. `null` ⇒ the caller must 401.
 */
export function currentCustomer(
  req: FastifyRequest,
  db: OncallDb,
  config: Config,
): CustomerRow | null {
  const user = currentUser(req, db, config);
  if (user?.customer_id) {
    const c = db.dao.customers.getById(user.customer_id);
    if (c) return c;
  }
  if (config.server.devNoAuth) {
    return db.dao.customers.getByIngestKey(config.ingest.apiKey);
  }
  return null;
}

/**
 * The GitHub token a repo-management call uses: the session user's OAuth token,
 * else (under `DEV_NO_AUTH`) the platform PAT so the demo can list/select the
 * pinned victim repo before OAuth is configured. `null` ⇒ 401.
 */
export function currentGithubToken(
  req: FastifyRequest,
  db: OncallDb,
  config: Config,
): string | null {
  const user = currentUser(req, db, config);
  if (user?.access_token) return user.access_token;
  if (config.server.devNoAuth && config.github.token) return config.github.token;
  return null;
}
