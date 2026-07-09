import type { ApiError, ErrorCode } from '@oncall/shared';
import { API_BASE } from '../config';

/**
 * Typed fetch layer (SPEC §6). All read/stream calls hit the platform base URL
 * under `/api/v1` with credentials (session cookie, or open under `DEV_NO_AUTH`).
 * Non-2xx bodies follow the SPEC §7 error shape `{ error: { code, message } }`.
 */

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'network';

  constructor(status: number, code: ErrorCode | 'network', message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

export interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
}

/** Build a full URL under `/api/v1` with an optional query string. */
export function apiUrl(
  path: string,
  query?: RequestOptions['query'],
): string {
  // `API_BASE` is absolute in prod and relative (`/api/v1`) in dev; resolve both
  // against the document origin so EventSource/fetch always get an absolute URL.
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const url = new URL(`${API_BASE}${path}`, origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function apiFetch<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = apiUrl(path, opts.query);

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError(0, 'network', 'Network error — is the platform running?');
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const apiErr = payload as ApiError | null;
    const code = apiErr?.error?.code ?? 'internal';
    const message = apiErr?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiRequestError(res.status, code, message);
  }

  return payload as T;
}
