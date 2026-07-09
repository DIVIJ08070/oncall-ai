/**
 * C7 REAL end-to-end LIVE investigation via the Claude Agent SDK (subscription).
 *
 *   npm run build && npx tsx packages/agent/scripts/live-investigate.ts
 *
 * Builds the full LiveClaudeEngine with the REAL Agent SDK `query()` loop + the
 * in-process MCP tools, seeds a bad_deploy incident on `checkout-api`, and lets
 * the agent investigate the seeded victim repo (`DIVIJ08070/oncall-ai-victim`)
 * end-to-end. On the happy path it opens a real revert PR and submits findings.
 *
 * Uses the developer's Claude Max subscription (USE_CLAUDE_SUBSCRIPTION=true, no
 * API key). Not part of the shipped package (scripts/ is excluded from the build);
 * it imports the compiled dist. Prints the step trace, the PR number, and the
 * SessionResult as evidence.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Octokit } from '@octokit/rest';
import {
  createPinnedGitHub,
  LiveClaudeEngine,
  type AgentEngineConfig,
  type EngineSessionsDao,
  type EngineStepsDao,
  type GitHubClient,
  type StepSink,
  type ToolDb,
} from '../dist/index.js';
import type { DeployRef, Incident, MetricSample } from '@oncall/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');

function loadEnv(): Record<string, string> {
  const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
  const env: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

/** Seeded bad-deploy commit (null-guard removal on src/routes/checkout.ts). */
const BAD_DEPLOY_SHA = '1faea629b497d3250927292cc69072c8c20008be';
const CUSTOMER_ID = 'cus_live';
const SERVICE = 'checkout-api';

function short(s: string): string {
  return s.slice(0, 7);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN missing from .env');

  // Force subscription auth for the spawned SDK subprocess.
  process.env.USE_CLAUDE_SUBSCRIPTION = 'true';
  if (!env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;

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

  // Realistic in-memory signal so the agent has metrics + logs + deploys to reason over.
  const now = Date.now();
  const deploys: DeployRef[] = [
    {
      id: 'dep_bad', customer_id: CUSTOMER_ID, sha: BAD_DEPLOY_SHA, short_sha: short(BAD_DEPLOY_SHA),
      ref: 'main', message: 'remove cart null-guard', author: 'seed',
      committed_at: now - 120_000, deployed_at: now - 120_000, is_current: true,
      source: 'bad_deploy', pr_id: null, created_at: now - 120_000,
    },
  ];
  const sample: MetricSample = {
    id: 1, customer_id: CUSTOMER_ID, service: SERVICE, bucket_ts: now, window_sec: 60,
    request_count: 40, error_count: 34, error_rate: 0.85, p50_ms: 40, p95_ms: 120, p99_ms: 260,
  };
  const errorLog = {
    id: 'log_1', customer_id: CUSTOMER_ID, service: SERVICE, timestamp: now - 5_000,
    received_at: now - 5_000, level: 'error' as const,
    message: "Cannot read properties of undefined (reading 'items')",
    stack: "TypeError: Cannot read properties of undefined (reading 'items')\n  at checkout (src/routes/checkout.ts:12)",
    endpoint: '/api/checkout', method: 'POST', status: 500, latency_ms: 20,
    fingerprint_sig: "cannot read properties of undefined (reading '<str>')",
  };

  const createdPrs: unknown[] = [];
  const db: ToolDb = {
    dao: {
      logEvents: { query: () => [errorLog] },
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
          console.log(`  [db] incident ${id} → ${JSON.stringify(patch)}`);
          return null;
        },
      },
      pullRequests: {
        create: (input) => {
          const row = {
            id: `pr_live_${createdPrs.length + 1}`, ...input, state: 'open' as const,
            created_at: Date.now(), merged_at: null,
            verification_status: 'pending' as const, verification_comment_id: null,
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

  const incident: Incident = {
    id: `inc_live_${now}`, customer_id: CUSTOMER_ID, service: SERVICE, detector: 'error_rate',
    fingerprint: 'live-c7', title: 'Error-rate spike on checkout-api', status: 'investigating',
    severity: 'high', threshold_value: 0.2, observed_value: 0.85,
    first_error_at: now - 30_000, detected_at: now - 20_000, opened_at: now - 20_000,
    root_cause: null, confidence: null, pr_id: null, suspect_deploy_sha: BAD_DEPLOY_SHA,
    resolved_at: null, postmortem: null, updated_at: now,
  };

  let seq = 0;
  const sessions: EngineSessionsDao = {
    create: (input) => {
      console.log(`\n[session] started (mode=${input.mode}, model=${input.model})`);
      return { id: `ses_live_${now}` };
    },
    finish: (id, fields) => {
      console.log(`[session] ${id} finished → status=${fields.status} decision=${fields.decision}`);
      return null;
    },
  };
  const steps: EngineStepsDao = {
    append: () => ({ seq: seq++ }),
  };

  const sink: StepSink = {
    step: (s) => {
      if (s.type === 'thought') console.log(`  💭 ${s.content}`);
      else if (s.type === 'tool_call') console.log(`  🔧 ${s.tool_name}(${JSON.stringify(s.tool_input)})`);
      else if (s.type === 'tool_result') {
        const out = JSON.stringify(s.tool_output);
        console.log(`  ⇐ ${s.tool_name} → ${out.length > 240 ? out.slice(0, 240) + '…' : out}`);
      } else if (s.type === 'conclusion') console.log(`  ✅ conclusion: ${s.content}`);
      else if (s.type === 'error') console.log(`  ❌ ${s.content}`);
    },
    prCreated: (d) => console.log(`  🔗 pr_created: #${d.number} (${d.kind}) ${d.url}`),
    conclusion: (d) => console.log(`  🏁 decision=${d.decision} confidence=${d.confidence}`),
  };

  console.log(`\n=== C7 LIVE INVESTIGATION vs ${config.github.owner}/${config.github.repo} ===`);
  console.log(`model=${config.agent.model}  maxTurns=${config.agent.maxIterations}\n`);

  const engine = new LiveClaudeEngine({ db, octokit: pinned, config, sessions, steps });
  const result = await engine.investigate(incident, sink);

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));
  if (result.pr_number) {
    console.log(`\nREAL PR OPENED: #${result.pr_number}  ${result.pr_url}`);
  } else {
    console.log(`\nNo PR opened — status=${result.status} decision=${result.decision}`);
  }
}

main().catch((err) => {
  console.error('\nLIVE INVESTIGATION FAILED:', err);
  process.exit(1);
});
