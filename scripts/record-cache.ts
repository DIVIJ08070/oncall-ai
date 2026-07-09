/**
 * scripts/record-cache.ts — record deterministic-replay caches (SPEC §13, NFR-09).
 *
 *   npm run build && npx tsx scripts/record-cache.ts [bad_deploy|slow_db|config_error ...]
 *
 * Runs the **LIVE** `LiveClaudeEngine` (real Claude Agent SDK, subscription auth)
 * once per requested scenario against the seeded victim repo
 * (`DIVIJ08070/oncall-ai-victim`) and serializes the ordered investigation steps
 * — thoughts, tool calls, tool results, the `create_fix_pr` intent, and the
 * conclusion — to `packages/agent/cache/<scenario>.json`. The `CachedEngine`
 * replays these to the same StepSink so the offline demo feed looks identical.
 *
 * Default: records `bad_deploy` (the demo primary). Pass scenario names to record
 * others. Each live run opens a REAL revert PR on the victim repo (that is the
 * point — the captured `create_fix_pr` output doubles as the canned fallback).
 *
 * Uses the developer's Claude Max subscription (USE_CLAUDE_SUBSCRIPTION=true, no
 * API key). Not shipped (scripts/ is excluded from the build); imports the built
 * `packages/agent/dist`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Octokit } from '@octokit/rest';
import {
  createPinnedGitHub,
  LiveClaudeEngine,
  SCENARIO_NAMES,
  type AgentEngineConfig,
  type CachedScenario,
  type CachedStep,
  type EngineSessionsDao,
  type EngineStepsDao,
  type GitHubClient,
  type ScenarioName,
  type StepSink,
  type ToolDb,
} from '../packages/agent/dist/index.js';
import type { DeployRef, Incident, MetricSample, SessionResult } from '@oncall/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CACHE_DIR = resolve(ROOT, 'packages/agent/cache');
const MANIFEST_PATH = resolve(ROOT, 'data/victim-manifest.json');

const CUSTOMER_ID = 'cus_record';
const SERVICE = 'checkout-api';

/* ── env + manifest ───────────────────────────────────────────────────────── */

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (t === '' || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  } catch {
    // no .env — rely on process.env
  }
  return { ...process.env, ...env } as Record<string, string>;
}

interface Manifest {
  baseline: { sha: string; short_sha: string; message: string; committed_at: number };
  modes: Record<ScenarioName, { sha: string; short_sha: string; message: string; committed_at: number }>;
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
}

const short = (s: string): string => s.slice(0, 7);

/* ── per-scenario incident + in-memory signal ─────────────────────────────── */

interface ScenarioSpec {
  detector: Incident['detector'];
  title: string;
  observed: number;
  threshold: number;
  metrics: Pick<MetricSample, 'error_rate' | 'p50_ms' | 'p95_ms' | 'p99_ms' | 'request_count' | 'error_count'>;
  errorLog: { level: 'error'; message: string; stack: string; endpoint: string; status: number; fingerprint_sig: string };
  keywords: string[];
}

function scenarioSpec(scenario: ScenarioName): ScenarioSpec {
  switch (scenario) {
    case 'bad_deploy':
      return {
        detector: 'error_rate',
        title: 'Error-rate spike on checkout-api',
        observed: 0.85,
        threshold: 0.2,
        metrics: { error_rate: 0.85, p50_ms: 40, p95_ms: 120, p99_ms: 260, request_count: 40, error_count: 34 },
        errorLog: {
          level: 'error',
          message: "Cannot read properties of undefined (reading 'items')",
          stack:
            "TypeError: Cannot read properties of undefined (reading 'items')\n  at checkout (src/routes/checkout.ts:12)",
          endpoint: '/api/checkout',
          status: 500,
          fingerprint_sig: "cannot read properties of undefined (reading '<str>')",
        },
        keywords: ['null', 'undefined', 'cannot read', 'typeerror', 'deref', 'checkout'],
      };
    case 'slow_db':
      return {
        detector: 'latency',
        title: 'Latency (p95) breach on checkout-api',
        observed: 3200,
        threshold: 1000,
        metrics: { error_rate: 0.0, p50_ms: 2400, p95_ms: 3200, p99_ms: 3800, request_count: 30, error_count: 0 },
        errorLog: {
          level: 'warn',
          message: 'GET /api/reports completed in 3187ms (slow query)',
          stack: '',
          endpoint: '/api/reports',
          status: 200,
          fingerprint_sig: 'get /api/reports completed in <n>ms (slow query)',
        },
        keywords: ['slow', 'latency', 'timeout', 'p95', 'report', 'query'],
      };
    case 'config_error':
      return {
        detector: 'error_rate',
        title: 'Error-rate spike on checkout-api (pricing)',
        observed: 0.6,
        threshold: 0.2,
        metrics: { error_rate: 0.6, p50_ms: 30, p95_ms: 90, p99_ms: 180, request_count: 25, error_count: 15 },
        errorLog: {
          level: 'error',
          message: 'Missing config PRICING_TABLE',
          stack: 'Error: Missing config PRICING_TABLE\n  at pricing (src/routes/pricing.ts:9)',
          endpoint: '/api/pricing',
          status: 500,
          fingerprint_sig: 'missing config pricing_table',
        },
        keywords: ['config', 'pricing', 'missing config', 'pricing_table'],
      };
  }
}

/** Build a ToolDb seeded with realistic metrics/logs/deploys the agent can reason over. */
function buildDb(
  spec: ScenarioSpec,
  manifest: Manifest,
  suspectSha: string,
  createdPrs: unknown[],
  patches: unknown[],
): ToolDb {
  const now = Date.now();
  const allShas: { sha: string; message: string; committed_at: number; source: string }[] = [
    { sha: manifest.baseline.sha, message: manifest.baseline.message, committed_at: manifest.baseline.committed_at, source: 'baseline' },
    ...SCENARIO_NAMES.map((s) => ({
      sha: manifest.modes[s].sha,
      message: manifest.modes[s].message.split('\n')[0],
      committed_at: manifest.modes[s].committed_at,
      source: 'bad_deploy',
    })),
  ];
  const deploys: DeployRef[] = allShas.map((c, i) => ({
    id: `dep_${i}`,
    customer_id: CUSTOMER_ID,
    sha: c.sha,
    short_sha: short(c.sha),
    ref: 'main',
    message: c.message,
    author: 'Victim Dev Team',
    committed_at: c.committed_at,
    deployed_at: c.committed_at,
    is_current: c.sha === suspectSha,
    source: c.source as DeployRef['source'],
    pr_id: null,
    created_at: c.committed_at,
  }));
  const sample: MetricSample = {
    id: 1,
    customer_id: CUSTOMER_ID,
    service: SERVICE,
    bucket_ts: now,
    window_sec: 60,
    ...spec.metrics,
  };
  const errorLog = {
    id: 'log_1',
    customer_id: CUSTOMER_ID,
    service: SERVICE,
    timestamp: now - 5_000,
    received_at: now - 5_000,
    ...spec.errorLog,
    method: 'GET',
    latency_ms: spec.metrics.p95_ms,
  };

  return {
    dao: {
      logEvents: { query: () => [errorLog as never] },
      metricSamples: {
        latestForService: () => sample,
        seriesForService: () => [sample],
      },
      deploys: {
        getBySha: (_c, sha) => deploys.find((d) => d.sha === sha) ?? null,
        getCurrent: () => deploys.find((d) => d.is_current) ?? null,
        listRecent: () => deploys,
      },
      incidents: {
        update: (id, patch) => {
          patches.push({ id, patch });
          return null;
        },
      },
      pullRequests: {
        create: (input) => {
          const row = {
            id: `pr_rec_${createdPrs.length + 1}`,
            ...input,
            state: 'open' as const,
            created_at: Date.now(),
            merged_at: null,
            verification_status: 'pending' as const,
            verification_comment_id: null,
          };
          createdPrs.push(row);
          return row;
        },
      },
      services: {
        getByName: () => ({ name: SERVICE, first_event_at: now - 600_000, last_event_at: now }),
      },
    },
  };
}

/* ── record one scenario via the LIVE engine ──────────────────────────────── */

async function recordScenario(
  scenario: ScenarioName,
  env: Record<string, string>,
  manifest: Manifest,
): Promise<void> {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN missing (needed for the live GitHub tools)');

  process.env.USE_CLAUDE_SUBSCRIPTION = 'true';
  if (!env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;

  const spec = scenarioSpec(scenario);
  const suspectSha = manifest.modes[scenario].sha;

  const config: AgentEngineConfig = {
    github: {
      owner: env.GITHUB_OWNER || 'DIVIJ08070',
      repo: env.GITHUB_REPO || 'oncall-ai-victim',
      defaultBranch: env.GITHUB_DEFAULT_BRANCH || 'main',
      protectedBranches: (env.GITHUB_PROTECTED_BRANCHES || 'main,master')
        .split(',').map((s) => s.trim()).filter(Boolean),
      token,
    },
    agent: {
      confidenceThreshold: Number(env.AGENT_CONFIDENCE_THRESHOLD || '0.6'),
      model: env.AGENT_MODEL || 'claude-sonnet-5',
      maxIterations: Number(env.AGENT_MAX_ITERATIONS || '10'),
      costCapUsd: Number(env.AGENT_COST_CAP_USD || '0.25'),
      mode: 'live',
      useClaudeSubscription: true,
      anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    },
  };

  const octokit = new Octokit({ auth: token });
  const pinned = createPinnedGitHub(octokit as unknown as GitHubClient, config.github);

  const createdPrs: unknown[] = [];
  const patches: unknown[] = [];
  const db = buildDb(spec, manifest, suspectSha, createdPrs, patches);

  const now = Date.now();
  const fingerprint = `record-${scenario}`;
  const incident: Incident = {
    id: `inc_rec_${scenario}_${now}`,
    customer_id: CUSTOMER_ID,
    service: SERVICE,
    detector: spec.detector,
    fingerprint,
    title: spec.title,
    status: 'investigating',
    severity: 'high',
    threshold_value: spec.threshold,
    observed_value: spec.observed,
    first_error_at: now - 30_000,
    detected_at: now - 20_000,
    opened_at: now - 20_000,
    root_cause: null,
    confidence: null,
    pr_id: null,
    suspect_deploy_sha: suspectSha,
    resolved_at: null,
    postmortem: null,
    updated_at: now,
  };

  let sessionModel = config.agent.model;
  const sessions: EngineSessionsDao = {
    create: (input) => {
      sessionModel = input.model;
      return { id: `ses_rec_${now}` };
    },
    finish: () => null,
  };
  let seq = 0;
  const steps: EngineStepsDao = { append: () => ({ seq: seq++ }) };

  const recorded: CachedStep[] = [];
  const sink: StepSink = {
    step: (s) => {
      recorded.push({
        type: s.type,
        tool_name: s.tool_name ?? null,
        tool_input: s.tool_input ?? null,
        tool_output: s.tool_output ?? null,
        content: s.content ?? null,
      });
      if (s.type === 'thought') console.log(`  💭 ${s.content}`);
      else if (s.type === 'tool_call') console.log(`  🔧 ${s.tool_name}(${JSON.stringify(s.tool_input)})`);
      else if (s.type === 'tool_result') {
        const out = JSON.stringify(s.tool_output);
        console.log(`  ⇐ ${s.tool_name} → ${out.length > 200 ? out.slice(0, 200) + '…' : out}`);
      } else if (s.type === 'conclusion') console.log(`  ✅ ${s.content}`);
      else if (s.type === 'error') console.log(`  ❌ ${s.content}`);
    },
    prCreated: (d) => console.log(`  🔗 pr_created #${d.number} (${d.kind}) ${d.url}`),
    conclusion: (d) => console.log(`  🏁 decision=${d.decision} confidence=${d.confidence}`),
  };

  console.log(`\n=== RECORDING "${scenario}" (LIVE, model=${config.agent.model}) vs ${config.github.owner}/${config.github.repo} ===`);
  const engine = new LiveClaudeEngine({ db, octokit: pinned, config, sessions, steps });
  const result: SessionResult = await engine.investigate(incident, sink);

  console.log(`\n  result: status=${result.status} decision=${result.decision} pr=#${result.pr_number ?? '—'} iterations=${result.iterations}`);
  if (result.decision !== 'propose_fix' || !result.pr_number) {
    console.warn(
      `  ⚠️  "${scenario}" did NOT reach a clean propose_fix with a PR — the trace is still written, ` +
        `but inspect it before relying on it for the demo.`,
    );
  }

  const cache: CachedScenario = {
    scenario,
    recorded_at: now,
    model: sessionModel,
    fingerprints: [fingerprint],
    match: {
      detector: spec.detector,
      suspect_deploy_sha: suspectSha,
      keywords: spec.keywords,
    },
    outcome: {
      status: result.status,
      decision: result.decision,
      root_cause: result.root_cause,
      confidence: result.confidence,
      iterations: result.iterations,
      cost_usd: result.cost_usd,
    },
    steps: recorded,
  };

  mkdirSync(CACHE_DIR, { recursive: true });
  const outPath = resolve(CACHE_DIR, `${scenario}.json`);
  writeFileSync(outPath, JSON.stringify(cache, null, 2) + '\n');
  console.log(`  → wrote ${outPath} (${recorded.length} steps)`);
}

/* ── main ─────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const env = loadEnv();
  const manifest = loadManifest();

  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const scenarios = (requested.length > 0 ? requested : ['bad_deploy']).filter((s): s is ScenarioName =>
    (SCENARIO_NAMES as readonly string[]).includes(s),
  );
  if (scenarios.length === 0) {
    console.error(`No valid scenarios. Choose from: ${SCENARIO_NAMES.join(', ')}`);
    process.exit(1);
  }

  for (const scenario of scenarios) {
    await recordScenario(scenario, env, manifest);
  }
  console.log('\n[record-cache] DONE');
}

main().catch((err) => {
  console.error('\n[record-cache] FAILED:', err);
  process.exit(1);
});
