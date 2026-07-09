/**
 * Metrics module (SPEC §10.2, §7.2, FR-04). Trailing-window rollups over
 * `log_events` (error rate, request volume, p50/p95/p99), the baseline
 * computation, and the `/metrics` + `/services` DTO builders. Consumed by the
 * detection loop (C5 `detection/`) and the read APIs (C10).
 */
export * from './percentile.js';
export * from './windows.js';
export * from './rollup.js';
export * from './baseline.js';
export * from './service.js';
