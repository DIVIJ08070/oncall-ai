/**
 * Victim app config (SPEC §12, §14 `VICTIM_*` / `ONCALL_*` subset).
 *
 * `config_error` mode hinges on `PRICING_TABLE`: in the seeded git history the
 * bad-deploy commit removes its default, so the deployed customer app throws
 * "Missing config PRICING_TABLE". The RUNNING demo app keeps the default present
 * and simulates that failure only while `activeMode === 'config_error'`.
 */

function numEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function strEnv(name: string, def: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? def : raw;
}

export const config = {
  /** Victim HTTP port (SPEC §14 default 4000). */
  port: numEnv('VICTIM_PORT', 4000),
  /** Single demo service name (SPEC examples use `checkout-api`). */
  service: strEnv('VICTIM_SERVICE', 'checkout-api'),
  /** Where telemetry is shipped (SPEC §14 `ONCALL_INGEST_URL`). */
  ingestUrl: strEnv('ONCALL_INGEST_URL', 'http://localhost:3001/api/v1/ingest'),
  /** Ingest key (SPEC §14 `ONCALL_API_KEY`, must match platform `INGEST_API_KEY`). */
  apiKey: strEnv('ONCALL_API_KEY', 'dev-local-ingest-key'),
  /**
   * Pricing config key (present in the healthy app). The seeded `config_error`
   * commit removes this default in the deployed code; here it stays present and
   * the failure is simulated per-request while that mode is active.
   */
  pricingTable: process.env.PRICING_TABLE ?? 'default-pricing-v1',
  /**
   * Fraction of `/api/pricing` requests that fail while `config_error` is active
   * (SPEC §12 "throws on subset"). Kept above the 0.2 detection threshold.
   */
  configErrorFailRatio: numEnv('VICTIM_CONFIG_ERROR_RATIO', 0.7),
  /** Simulated slow-query delay window (ms) for `slow_db` (SPEC §12: 2–4s). */
  slowDbMinMs: numEnv('VICTIM_SLOW_DB_MIN_MS', 2200),
  slowDbMaxMs: numEnv('VICTIM_SLOW_DB_MAX_MS', 3800),
  /**
   * Optional path to the seed manifest (mode → real bad SHA), written by
   * `scripts/init-victim-repo.ts`. If absent, `deployed_sha` reports `null`.
   */
  manifestPath: process.env.VICTIM_MANIFEST_PATH,
} as const;

export type FailureMode = 'healthy' | 'bad_deploy' | 'slow_db' | 'config_error';

export const FAILURE_MODES: readonly FailureMode[] = [
  'healthy',
  'bad_deploy',
  'slow_db',
  'config_error',
];

export function isFailureMode(v: unknown): v is FailureMode {
  return typeof v === 'string' && (FAILURE_MODES as readonly string[]).includes(v);
}
