/**
 * C6 REAL end-to-end tool exercise against the live victim repo
 * (`DIVIJ08070/oncall-ai-victim`). Run once for self-verification:
 *
 *   npm run build && npx tsx packages/agent/scripts/live-e2e.ts
 *
 * It reads the token from the repo-root `.env`, builds the pinned GitHub facade,
 * and drives the read tools + `create_fix_pr` (revert) against real GitHub. The
 * created PR number is printed at the end. Nothing here is part of the shipped
 * package (scripts/ is excluded from the build); it imports the compiled dist.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Octokit } from '@octokit/rest';
import {
  createPinnedGitHub,
  getRecentDeploys,
  getDeployDiff,
  readFile,
  createFixPr,
  submitFindings,
  type GitHubClient,
  type ToolConfig,
  type ToolContext,
  type ToolDb,
} from '../dist/index.js';
import type { Incident } from '@oncall/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');

/** Minimal .env parser (avoids a dotenv dep in this package). */
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

/** Bad-deploy commit (null-guard removal on src/routes/checkout.ts). */
const BAD_DEPLOY_SHA = '1faea629b497d3250927292cc69072c8c20008be';

async function main(): Promise<void> {
  const env = loadEnv();
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN missing from .env');

  const config: ToolConfig = {
    github: {
      owner: env.GITHUB_OWNER || 'DIVIJ08070',
      repo: env.GITHUB_REPO || 'oncall-ai-victim',
      defaultBranch: env.GITHUB_DEFAULT_BRANCH || 'main',
      protectedBranches: (env.GITHUB_PROTECTED_BRANCHES || 'main,master')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      token,
    },
    agent: { confidenceThreshold: Number(env.AGENT_CONFIDENCE_THRESHOLD || '0.6') },
  };

  const octokit = new Octokit({ auth: token });
  const pinned = createPinnedGitHub(octokit as unknown as GitHubClient, config.github);

  // Minimal in-memory DB for the two DB-touching tools used here.
  const createdPrs: unknown[] = [];
  const db: ToolDb = {
    dao: {
      logEvents: { query: () => [] },
      metricSamples: { latestForService: () => null, seriesForService: () => [] },
      deploys: { getBySha: () => null, getCurrent: () => null, listRecent: () => [] },
      incidents: {
        update: (id, patch) => {
          console.log(`  [db] incident ${id} patched:`, JSON.stringify(patch));
          return null;
        },
      },
      pullRequests: {
        create: (input) => {
          const row = {
            id: `pr_live_${createdPrs.length + 1}`,
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
      services: { getByName: () => null },
    },
  };

  const incident: Incident = {
    id: `inc_live_e2e_${Date.now()}`,
    customer_id: 'cus_live',
    service: 'checkout-api',
    detector: 'error_rate',
    fingerprint: 'live-e2e',
    title: 'Error-rate spike on checkout-api',
    status: 'investigating',
    severity: 'high',
    threshold_value: 0.2,
    observed_value: 0.9,
    first_error_at: Date.now() - 30_000,
    detected_at: Date.now() - 20_000,
    opened_at: Date.now() - 20_000,
    root_cause: null,
    confidence: null,
    pr_id: null,
    suspect_deploy_sha: BAD_DEPLOY_SHA,
    resolved_at: null,
    postmortem: null,
    updated_at: Date.now(),
  };

  const ctx: ToolContext = {
    db,
    octokit: pinned,
    config,
    customer: { id: incident.customer_id },
    incident,
    sink: {
      prCreated: (d) => console.log('  [sink] pr_created:', JSON.stringify(d)),
      conclusion: (d) => console.log('  [sink] conclusion:', JSON.stringify(d)),
    },
  };

  console.log(`\n=== C6 LIVE E2E vs ${config.github.owner}/${config.github.repo} ===\n`);

  // 1. get_recent_deploys — should list the seeded commits.
  console.log('1) get_recent_deploys:');
  const deploys = await getRecentDeploys(ctx, { limit: 10 });
  for (const d of deploys.deploys) {
    console.log(`   ${d.short_sha}  ${d.message_first_line}  (${d.author})`);
  }

  // 2. get_deploy_diff on the bad-deploy sha — the null-guard diff.
  console.log('\n2) get_deploy_diff(1faea62):');
  const diff = await getDeployDiff(ctx, { sha: BAD_DEPLOY_SHA });
  console.log(`   base=${diff.base.slice(0, 7)} head=${diff.head.slice(0, 7)} files=${diff.total_files} (+${diff.total_additions}/-${diff.total_deletions})`);
  for (const f of diff.files) {
    console.log(`   ${f.status}  ${f.path}  (+${f.additions}/-${f.deletions})`);
    if (f.patch_excerpt) console.log(f.patch_excerpt.split('\n').map((l) => `      ${l}`).join('\n'));
  }

  // 3. read_file — a real file at HEAD.
  console.log('\n3) read_file(src/routes/checkout.ts):');
  const file = await readFile(ctx, { path: 'src/routes/checkout.ts' });
  console.log(`   ref=${file.ref} total_lines=${file.total_lines} returned=${file.returned_lines} truncated=${file.truncated}`);
  console.log(file.content.split('\n').slice(0, 8).map((l) => `      ${l}`).join('\n'));

  // 4. create_fix_pr revert — opens a REAL PR reverting the bad deploy.
  console.log('\n4) create_fix_pr(revert 1faea62): opening a REAL PR…');
  const pr = await createFixPr(ctx, {
    kind: 'revert',
    confidence: 0.92,
    root_cause: 'Null dereference on POST /api/checkout introduced by deploy 1faea62 (removed the cart null-guard).',
    title: 'Revert "remove cart null-guard" (fix checkout 500s)',
    body: [
      '## Incident Summary',
      'Error-rate spike on `checkout-api` — `POST /api/checkout` returns 500 (`TypeError: Cannot read properties of undefined`).',
      '',
      '## Root Cause',
      'Deploy `1faea62` removed the null-guard in `src/routes/checkout.ts`.',
      '',
      '## Proposed Fix',
      'Revert `1faea62`, restoring the guard to its previous (baseline) content.',
      '',
      '## Risk Assessment',
      'Low — a single-file revert to a known-good state.',
      '',
      '_Generated by OnCall AI — human review required._',
    ].join('\n'),
    revert_sha: BAD_DEPLOY_SHA,
  });

  // 5. submit_findings — the terminal control tool.
  await submitFindings(ctx, {
    root_cause: 'Null deref from deploy 1faea62',
    evidence: [{ type: 'tool', tool: 'get_deploy_diff', ref: BAD_DEPLOY_SHA }],
    confidence: 0.92,
    decision: 'propose_fix',
  });

  console.log('\n=== RESULT ===');
  if ('escalate' in pr) {
    console.log('create_fix_pr ESCALATED (unexpected):', pr.reason);
  } else {
    console.log(`REAL PR OPENED: #${pr.pr_number}`);
    console.log(`URL:    ${pr.url}`);
    console.log(`branch: ${pr.branch}  base: ${pr.base}  head_sha: ${pr.head_sha.slice(0, 7)}`);
  }
}

main().catch((err) => {
  console.error('LIVE E2E FAILED:', err);
  process.exit(1);
});
