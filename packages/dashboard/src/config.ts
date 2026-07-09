/**
 * Frontend → API wiring (SPEC §6 "Frontend→API rule"). All calls go to the
 * platform base URL under `/api/v1`; SSE uses the same base. Base URL comes from
 * `PUBLIC_BASE_URL` (default `http://localhost:3001`).
 */

const CONFIGURED_BASE =
  (import.meta.env.PUBLIC_BASE_URL as string | undefined)?.trim() ||
  'http://localhost:3001';

/**
 * Platform origin (no trailing slash). In Vite **dev** we call the platform through
 * a same-origin `/api` proxy (see vite.config) so fetch + SSE avoid CORS — hence an
 * empty base (relative). A **production** build calls `PUBLIC_BASE_URL` directly.
 */
export const BASE_URL = import.meta.env.DEV ? '' : CONFIGURED_BASE.replace(/\/+$/, '');

/** Versioned API prefix. */
export const API_BASE = `${BASE_URL}/api/v1`;

/** Poll cadence for ServiceHealth + metrics (DESIGN_SPEC §8.1/§8.3 — every 5s). */
export const POLL_INTERVAL_MS = 5000;

/** Time-range presets for the metrics window (DESIGN_SPEC §6.2). */
export const TIME_RANGES = [
  { label: '15m', window_sec: 900 },
  { label: '1h', window_sec: 3600 },
  { label: '3h', window_sec: 10800 },
] as const;

/**
 * Detection thresholds surfaced in the UI (breach coloring + chart reference
 * lines). Mirror the platform defaults (SPEC §14 / DESIGN_SPEC §8.1/§9); these
 * are display constants only — the server is the source of truth for detection.
 */
export const ERROR_RATE_THRESHOLD = 0.2;
export const LATENCY_P95_THRESHOLD_MS = 1000;
