import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Minimal signed-cookie helpers (SPEC §7.5). Kept dependency-free (no
 * `@fastify/cookie`) so C9 lands without touching the workspace lockfile while
 * C7 commits in parallel. Cookies are HMAC-SHA256 signed with `SESSION_SECRET`
 * so a tampered/forged session or OAuth-state value is rejected.
 *
 * Format of a signed value: `<urlEncodedValue>.<base64urlSignature>`.
 */

export interface CookieOptions {
  /** `Max-Age` in seconds (omit for a session cookie). */
  maxAgeSec?: number;
  path?: string;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  secure?: boolean;
}

const DEFAULT_OPTS: Required<Omit<CookieOptions, 'maxAgeSec'>> = {
  path: '/',
  httpOnly: true,
  sameSite: 'Lax',
  secure: false,
};

/** HMAC-SHA256 of `value` keyed by `secret`, base64url-encoded. */
function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

/** Produce a signed cookie value (`value.signature`). */
export function signValue(value: string, secret: string): string {
  return `${value}.${sign(value, secret)}`;
}

/**
 * Verify + extract the original value from a signed cookie, or `null` when the
 * signature is missing/tampered. Uses a constant-time comparison.
 */
export function unsignValue(signed: string, secret: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx <= 0) return null;
  const value = signed.slice(0, idx);
  const provided = signed.slice(idx + 1);
  const expected = sign(value, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? value : null;
}

/** Serialize a `Set-Cookie` header value. */
export function serializeCookie(
  name: string,
  value: string,
  opts: CookieOptions = {},
): string {
  const o = { ...DEFAULT_OPTS, ...opts };
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path}`];
  if (opts.maxAgeSec !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAgeSec)}`);
  if (o.httpOnly) parts.push('HttpOnly');
  parts.push(`SameSite=${o.sameSite}`);
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Parse a raw `Cookie` request header into a name→value map (URL-decoded). */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return out;
}

/** Read one raw (unsigned) cookie value from the request. */
export function readCookie(req: FastifyRequest, name: string): string | undefined {
  return parseCookieHeader(req.headers.cookie)[name];
}

/** Read + verify a signed cookie; `null` on absence or bad signature. */
export function readSignedCookie(
  req: FastifyRequest,
  name: string,
  secret: string,
): string | null {
  const raw = readCookie(req, name);
  if (raw === undefined) return null;
  return unsignValue(raw, secret);
}

/**
 * Append a `Set-Cookie` header without clobbering ones already staged on the
 * reply (the callback sets a session cookie *and* clears the state cookie).
 */
export function appendSetCookie(reply: FastifyReply, cookie: string): void {
  const existing = reply.getHeader('set-cookie');
  if (existing === undefined) {
    reply.header('set-cookie', cookie);
  } else if (Array.isArray(existing)) {
    reply.header('set-cookie', [...existing, cookie]);
  } else {
    reply.header('set-cookie', [String(existing), cookie]);
  }
}

/** Stage a signed cookie on the reply. */
export function setSignedCookie(
  reply: FastifyReply,
  name: string,
  value: string,
  secret: string,
  opts: CookieOptions = {},
): void {
  appendSetCookie(reply, serializeCookie(name, signValue(value, secret), opts));
}

/** Stage a cookie deletion (empty value, `Max-Age=0`). */
export function clearCookie(
  reply: FastifyReply,
  name: string,
  opts: CookieOptions = {},
): void {
  appendSetCookie(reply, serializeCookie(name, '', { ...opts, maxAgeSec: 0 }));
}
