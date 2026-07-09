import { z } from 'zod';

/**
 * Server config loader (SPEC §14 env contract).
 *
 * `loadConfig(env)` is pure and fully testable — it validates + defaults a raw
 * environment map and returns a structured, typed `Config`. `bootstrapEnv()`
 * loads `.env` into `process.env` (idempotent) for the server boot path; tests
 * call `loadConfig({...})` directly and never touch the filesystem.
 */

/* ── env-string coercers ────────────────────────────────────────────────── */

/** Treat empty strings as "unset" so `.default()` applies. */
const blankToUndefined = (v: unknown): unknown =>
  v === undefined || v === null || v === '' ? undefined : v;

const boolEnv = (def: boolean) =>
  z.preprocess((v) => {
    const s = blankToUndefined(v);
    if (s === undefined) return def;
    if (typeof s === 'boolean') return s;
    const t = String(s).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(t)) return true;
    if (['false', '0', 'no', 'off'].includes(t)) return false;
    return s; // let zod flag anything unexpected
  }, z.boolean());

const numEnv = (def: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().default(def));

const strEnv = (def: string) =>
  z.preprocess(blankToUndefined, z.string().default(def));

/** Optional string that is `undefined` when unset/blank (e.g. secrets). */
const optStr = () =>
  z.preprocess(blankToUndefined, z.string().optional());

/* ── raw env schema (keys exactly as in SPEC §14) ───────────────────────── */

const EnvSchema = z.object({
  // agent
  USE_CLAUDE_SUBSCRIPTION: boolEnv(true),
  ANTHROPIC_API_KEY: optStr(),
  AGENT_MODEL: strEnv('claude-sonnet-5'),
  AGENT_MODE: z.preprocess(
    blankToUndefined,
    z.enum(['auto', 'live', 'cached']).default('auto'),
  ),
  AGENT_MAX_ITERATIONS: numEnv(10),
  AGENT_CONFIDENCE_THRESHOLD: numEnv(0.6),
  AGENT_COST_CAP_USD: numEnv(0.25),
  CACHE_REAL_PR: boolEnv(true),

  // github
  GITHUB_TOKEN: optStr(),
  GITHUB_OWNER: strEnv('DIVIJ08070'),
  GITHUB_REPO: strEnv('oncall-ai-victim'),
  GITHUB_DEFAULT_BRANCH: strEnv('main'),
  GITHUB_PROTECTED_BRANCHES: strEnv('main,master'),
  GITHUB_OAUTH_CLIENT_ID: optStr(),
  GITHUB_OAUTH_CLIENT_SECRET: optStr(),

  // ingest / notify
  INGEST_API_KEY: strEnv('dev-local-ingest-key'),
  SLACK_WEBHOOK_URL: optStr(),

  // server / auth
  PORT: numEnv(3001),
  DATABASE_URL: strEnv('./data/oncall.sqlite'),
  PUBLIC_BASE_URL: strEnv('http://localhost:3001'),
  DASHBOARD_URL: strEnv('http://localhost:5173'),
  SESSION_SECRET: strEnv('dev-secret-change-me'),
  DEV_NO_AUTH: boolEnv(true),

  // detection
  DETECTION_INTERVAL_MS: numEnv(15000),
  ERROR_RATE_THRESHOLD: numEnv(0.2),
  MIN_REQUESTS_FOR_DETECTION: numEnv(5),
  LATENCY_P95_THRESHOLD_MS: numEnv(1000),
  SILENCE_WINDOW_MS: numEnv(60000),
  RECOVERY_WINDOW_MS: numEnv(60000),
  MERGE_POLL_INTERVAL_MS: numEnv(5000),

  // victim
  VICTIM_PORT: numEnv(4000),
  VICTIM_CONTROL_URL: strEnv('http://localhost:4000'),
  ONCALL_INGEST_URL: strEnv('http://localhost:3001/api/v1/ingest'),
  ONCALL_API_KEY: strEnv('dev-local-ingest-key'),
});

export type Env = z.infer<typeof EnvSchema>;

/* ── structured, typed config ───────────────────────────────────────────── */

export interface Config {
  agent: {
    useClaudeSubscription: boolean;
    anthropicApiKey?: string;
    model: string;
    mode: 'auto' | 'live' | 'cached';
    maxIterations: number;
    confidenceThreshold: number;
    costCapUsd: number;
    cacheRealPr: boolean;
  };
  github: {
    token?: string;
    owner: string;
    repo: string;
    defaultBranch: string;
    protectedBranches: string[];
    oauthClientId?: string;
    oauthClientSecret?: string;
  };
  ingest: {
    apiKey: string;
  };
  notify: {
    slackWebhookUrl?: string;
  };
  server: {
    port: number;
    databaseUrl: string;
    publicBaseUrl: string;
    dashboardUrl: string;
    sessionSecret: string;
    devNoAuth: boolean;
  };
  detection: {
    intervalMs: number;
    errorRateThreshold: number;
    minRequestsForDetection: number;
    latencyP95ThresholdMs: number;
    silenceWindowMs: number;
    recoveryWindowMs: number;
    mergePollIntervalMs: number;
  };
  victim: {
    port: number;
    controlUrl: string;
    ingestUrl: string;
    apiKey: string;
  };
}

const splitBranches = (raw: string): string[] =>
  raw
    .split(',')
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

/**
 * Validate a raw environment map and assemble the structured config.
 * Throws a readable error (listing offending keys) when validation fails.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration (SPEC §14):\n${issues}`);
  }
  const e = parsed.data;
  return {
    agent: {
      useClaudeSubscription: e.USE_CLAUDE_SUBSCRIPTION,
      anthropicApiKey: e.ANTHROPIC_API_KEY,
      model: e.AGENT_MODEL,
      mode: e.AGENT_MODE,
      maxIterations: e.AGENT_MAX_ITERATIONS,
      confidenceThreshold: e.AGENT_CONFIDENCE_THRESHOLD,
      costCapUsd: e.AGENT_COST_CAP_USD,
      cacheRealPr: e.CACHE_REAL_PR,
    },
    github: {
      token: e.GITHUB_TOKEN,
      owner: e.GITHUB_OWNER,
      repo: e.GITHUB_REPO,
      defaultBranch: e.GITHUB_DEFAULT_BRANCH,
      protectedBranches: splitBranches(e.GITHUB_PROTECTED_BRANCHES),
      oauthClientId: e.GITHUB_OAUTH_CLIENT_ID,
      oauthClientSecret: e.GITHUB_OAUTH_CLIENT_SECRET,
    },
    ingest: {
      apiKey: e.INGEST_API_KEY,
    },
    notify: {
      slackWebhookUrl: e.SLACK_WEBHOOK_URL,
    },
    server: {
      port: e.PORT,
      databaseUrl: e.DATABASE_URL,
      publicBaseUrl: e.PUBLIC_BASE_URL,
      dashboardUrl: e.DASHBOARD_URL,
      sessionSecret: e.SESSION_SECRET,
      devNoAuth: e.DEV_NO_AUTH,
    },
    detection: {
      intervalMs: e.DETECTION_INTERVAL_MS,
      errorRateThreshold: e.ERROR_RATE_THRESHOLD,
      minRequestsForDetection: e.MIN_REQUESTS_FOR_DETECTION,
      latencyP95ThresholdMs: e.LATENCY_P95_THRESHOLD_MS,
      silenceWindowMs: e.SILENCE_WINDOW_MS,
      recoveryWindowMs: e.RECOVERY_WINDOW_MS,
      mergePollIntervalMs: e.MERGE_POLL_INTERVAL_MS,
    },
    victim: {
      port: e.VICTIM_PORT,
      controlUrl: e.VICTIM_CONTROL_URL,
      ingestUrl: e.ONCALL_INGEST_URL,
      apiKey: e.ONCALL_API_KEY,
    },
  };
}

/**
 * Load `.env` into `process.env` (idempotent). Call once at server boot before
 * `loadConfig()`. Dynamic import keeps `dotenv` off the pure/test path.
 */
let dotenvLoaded = false;
export async function bootstrapEnv(): Promise<void> {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  try {
    const dotenv = await import('dotenv');
    dotenv.config();
  } catch {
    // dotenv absent or .env missing — rely on the ambient environment.
  }
}

/** Convenience: bootstrap `.env` then load config from `process.env`. */
export async function initConfig(): Promise<Config> {
  await bootstrapEnv();
  return loadConfig(process.env);
}
