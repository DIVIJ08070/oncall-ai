import { describe, it, expect } from 'vitest';
import type { DeployRef, MetricSample } from '@oncall/shared';
import {
  searchLogs,
  getMetrics,
  getRecentDeploys,
  getDeployDiff,
  readFile,
  createFixPr,
  submitFindings,
  runTool,
  READONLY_TOOL_NAMES,
  TOOL_DEFINITIONS,
} from '../src/tools/index.js';
import { SafetyViolationError } from '../src/guards.js';
import { makeCtx, makeFakeDb, makeIncident } from './helpers.js';
import type { ToolLogRow } from '../src/ports.js';

const CUS = 'cus_TEST';

function log(over: Partial<ToolLogRow>): ToolLogRow {
  return {
    id: `log_${Math.random().toString(36).slice(2)}`,
    customer_id: CUS,
    service: 'checkout-api',
    timestamp: 1_752_000_000_000,
    received_at: 1_752_000_000_000,
    level: 'error',
    message: 'boom',
    stack: null,
    endpoint: null,
    method: null,
    status: null,
    latency_ms: null,
    fingerprint_sig: null,
    ...over,
  };
}

function sample(over: Partial<MetricSample>): MetricSample {
  return {
    customer_id: CUS,
    service: 'checkout-api',
    bucket_ts: 0,
    window_sec: 60,
    request_count: 100,
    error_count: 0,
    error_rate: 0,
    p50_ms: 40,
    p95_ms: 120,
    p99_ms: 260,
    ...over,
  };
}

function deploy(over: Partial<DeployRef>): DeployRef {
  return {
    id: `dep_${Math.random().toString(36).slice(2)}`,
    customer_id: CUS,
    sha: 'sha',
    short_sha: 'sha',
    ref: 'main',
    message: 'commit',
    author: 'dev',
    committed_at: 1,
    deployed_at: null,
    is_current: false,
    source: 'baseline',
    pr_id: null,
    created_at: 1,
    ...over,
  };
}

/* ── search_logs ──────────────────────────────────────────────────────────── */

describe('search_logs', () => {
  it('returns ≤ limit rows and summarizes the remainder by signature', async () => {
    const logs: ToolLogRow[] = [];
    for (let i = 0; i < 40; i++) {
      logs.push(log({ timestamp: 2000 + i, message: `Cannot read items ${i}`, fingerprint_sig: 'cannot read <n>' }));
    }
    for (let i = 0; i < 3; i++) logs.push(log({ timestamp: 3000 + i, message: `timeout ${i}`, fingerprint_sig: 'timeout <n>' }));
    const incident = makeIncident({ customer_id: CUS });
    const db = makeFakeDb({ logs }, incident);
    const { ctx } = makeCtx({ db, incident });

    const out = await searchLogs(ctx, { service: 'checkout-api', level: 'error', limit: 30 });
    expect(out.total_matched).toBe(43);
    expect(out.returned).toBe(30);
    expect(out.events).toHaveLength(30);
    expect(out.truncated).toBe(true);
    // remainder (13 rows) summarized by signature
    const sigs = out.patterns.map((p) => p.signature);
    expect(sigs).toContain('cannot read <n>');
    expect(out.patterns.reduce((n, p) => n + p.count, 0)).toBe(13);
  });

  it('applies endpoint/status/query in-memory filters and caps the stack excerpt', async () => {
    const logs = [
      log({ endpoint: '/api/checkout', status: 500, message: 'null deref', stack: 'E'.repeat(5000) }),
      log({ endpoint: '/api/other', status: 200, message: 'ok', level: 'info' }),
    ];
    const incident = makeIncident({ customer_id: CUS });
    const { ctx } = makeCtx({ db: makeFakeDb({ logs }, incident), incident });
    const out = await searchLogs(ctx, { endpoint: '/api/checkout', status: 500, query: 'null', limit: 30 });
    expect(out.returned).toBe(1);
    expect(out.events[0].stack_excerpt!.length).toBeLessThanOrEqual(1200);
    expect(out.events[0].endpoint).toBe('/api/checkout');
  });
});

/* ── get_metrics ──────────────────────────────────────────────────────────── */

describe('get_metrics', () => {
  it('reports latest sample as current + a trailing baseline + a capped series', async () => {
    const now = Date.now();
    const samples = [
      sample({ bucket_ts: now - 400_000, error_rate: 0.01, p95_ms: 130, request_count: 50 }),
      sample({ bucket_ts: now - 180_000, error_rate: 0.02, p95_ms: 140, request_count: 60 }),
      sample({ bucket_ts: now - 120_000, error_rate: 0.0, p95_ms: 120, request_count: 55 }),
      sample({ bucket_ts: now - 10_000, error_rate: 0.87, p95_ms: 900, request_count: 80, error_count: 70 }),
    ];
    const incident = makeIncident({ customer_id: CUS });
    const { ctx } = makeCtx({ db: makeFakeDb({ samples }, incident), incident });
    const out = await getMetrics(ctx, { service: 'checkout-api', window_sec: 900, resolution_sec: 15 });
    expect(out.current.error_rate).toBeCloseTo(0.87);
    expect(out.current.req_count).toBe(80);
    // baseline excludes the last 60 s spike → averaged from the two mid samples
    expect(out.baseline.error_rate).toBeCloseTo(0.01, 2);
    expect(out.series.length).toBeGreaterThan(0);
    expect(out.series.length).toBeLessThanOrEqual(60);
  });

  it('returns zeros for a service with no samples', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const { ctx } = makeCtx({ db: makeFakeDb({}, incident), incident });
    const out = await getMetrics(ctx, { service: 'ghost', window_sec: 900, resolution_sec: 15 });
    expect(out.current).toEqual({ error_rate: 0, req_count: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0 });
    expect(out.series).toEqual([]);
  });
});

/* ── get_recent_deploys ───────────────────────────────────────────────────── */

describe('get_recent_deploys', () => {
  it('lists commits and flags the current deploy from the DB', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const db = makeFakeDb(
      { deploys: [deploy({ sha: 'bbb', is_current: true }), deploy({ sha: 'aaa' })] },
      incident,
    );
    const { ctx } = makeCtx({
      db,
      incident,
      githubSeed: {
        commitList: [
          { sha: 'ccc', message: 'config change' },
          { sha: 'bbb', message: 'slow query' },
          { sha: 'aaa', message: 'baseline' },
        ],
      },
    });
    const out = await getRecentDeploys(ctx, { limit: 10 });
    expect(out.deploys.map((d) => d.sha)).toEqual(['ccc', 'bbb', 'aaa']);
    expect(out.deploys.find((d) => d.sha === 'bbb')!.is_current).toBe(true);
    expect(out.deploys.find((d) => d.sha === 'ccc')!.is_current).toBe(false);
    expect(out.deploys[0].short_sha).toBe('ccc');
  });
});

/* ── get_deploy_diff ──────────────────────────────────────────────────────── */

describe('get_deploy_diff', () => {
  it('single-sha diff: parent as base, skips lockfiles, excerpts source patch', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const { ctx } = makeCtx({
      incident,
      githubSeed: {
        commits: {
          badSha: {
            parents: ['parentSha'],
            files: [
              { filename: 'src/routes/checkout.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-guard\n+noguard' },
              { filename: 'package-lock.json', status: 'modified', additions: 500, deletions: 400, patch: 'huge'.repeat(5000) },
            ],
          },
        },
      },
    });
    const out = await getDeployDiff(ctx, { sha: 'badSha' });
    expect(out.base).toBe('parentSha');
    expect(out.head).toBe('badSha');
    expect(out.total_files).toBe(2);
    const src = out.files.find((f) => f.path === 'src/routes/checkout.ts')!;
    expect(src.patch_excerpt).toContain('noguard');
    const lock = out.files.find((f) => f.path === 'package-lock.json')!;
    expect(lock.status).toBe('skipped');
    expect(lock.patch_excerpt).toBe('');
  });

  it('base/head compare diff', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const { ctx } = makeCtx({
      incident,
      githubSeed: {
        compares: {
          'aaa...bbb': {
            baseSha: 'aaa',
            files: [{ filename: 'src/config.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@' }],
          },
        },
      },
    });
    const out = await getDeployDiff(ctx, { base: 'aaa', head: 'bbb' });
    expect(out.base).toBe('aaa');
    expect(out.head).toBe('bbb');
    expect(out.files).toHaveLength(1);
  });
});

/* ── read_file ────────────────────────────────────────────────────────────── */

describe('read_file', () => {
  it('reads content, supports a 1-based inclusive line range', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const { ctx } = makeCtx({
      incident,
      githubSeed: { contents: { 'main:src/a.ts': 'l1\nl2\nl3\nl4\nl5\n' } },
    });
    const full = await readFile(ctx, { path: 'src/a.ts' });
    expect(full.total_lines).toBe(6); // trailing newline → 6 split parts
    const ranged = await readFile(ctx, { path: 'src/a.ts', start_line: 2, end_line: 3 });
    expect(ranged.content).toBe('l2\nl3');
  });

  it('rejects path traversal and absolute paths', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const { ctx } = makeCtx({ incident });
    await expect(readFile(ctx, { path: '../../etc/passwd' })).rejects.toThrow(SafetyViolationError);
    await expect(readFile(ctx, { path: '/etc/passwd' })).rejects.toThrow(SafetyViolationError);
  });
});

/* ── create_fix_pr (write tool) ───────────────────────────────────────────── */

describe('create_fix_pr', () => {
  const revertSeed = {
    refs: { 'heads/main': 'baseHeadSha' },
    commits: {
      baseHeadSha: { treeSha: 'baseTreeSha', parents: ['x'], files: [] },
      badSha: {
        parents: ['parentSha'],
        files: [{ filename: 'src/routes/checkout.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@' }],
      },
    },
    contents: { 'parentSha:src/routes/checkout.ts': 'export const guard = true;\n' },
    prNumber: 99,
    prId: 7001,
  };

  it('REFUSES + escalates below the confidence threshold (FR-13) — no GitHub write', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const { ctx, github, db } = makeCtx({ incident, githubSeed: revertSeed });
    const out = await createFixPr(ctx, {
      kind: 'revert',
      confidence: 0.4,
      root_cause: 'null deref',
      title: 'Revert',
      body: 'report',
      revert_sha: 'badSha',
    });
    expect(out).toEqual({ escalate: true, reason: 'confidence below threshold' });
    expect(github.calls).toHaveLength(0);
    expect(db.createdPrs).toHaveLength(0);
  });

  it('opens a revert PR, persists the pull_requests row, links the incident, emits pr_created', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const { ctx, db, sink } = makeCtx({ incident, githubSeed: revertSeed });
    const out = await createFixPr(ctx, {
      kind: 'revert',
      confidence: 0.92,
      root_cause: 'Null deref introduced by bad deploy',
      title: 'Revert null-guard removal',
      body: '## Root Cause\n…',
      revert_sha: 'badSha',
    });
    expect(out).toMatchObject({ pr_number: 99, base: 'main' });
    if ('branch' in out) expect(out.branch).toMatch(/^oncall-ai\/fix-inc_TEST01-[0-9a-f]{6}$/);

    // persisted PR row
    expect(db.createdPrs).toHaveLength(1);
    expect(db.createdPrs[0]).toMatchObject({
      incident_id: 'inc_TEST01',
      github_pr_number: 99,
      kind: 'revert',
      base_branch: 'main',
      state: 'open',
    });
    // linked the incident: status fix_proposed + pr_id + root_cause
    const patch = db.patches.find((p) => p.patch.status === 'fix_proposed');
    expect(patch).toBeDefined();
    expect(patch!.patch.pr_id).toBe('pr_1');
    expect(patch!.patch.confidence).toBe(0.92);
    // emitted the pr_created feed event
    expect(sink.prCreatedCalls).toEqual([{ number: 99, url: expect.any(String), kind: 'revert' }]);
  });

  it('opens a patch PR from files[]', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const { ctx, db } = makeCtx({
      incident,
      githubSeed: { refs: { 'heads/main': 'baseHeadSha' }, commits: { baseHeadSha: { treeSha: 'baseTreeSha', parents: ['x'], files: [] } }, prNumber: 5 },
    });
    const out = await createFixPr(ctx, {
      kind: 'patch',
      confidence: 0.8,
      root_cause: 'x',
      title: 'Patch',
      body: 'b',
      files: [{ path: 'src/config.ts', content: 'export const PRICING_TABLE = "default";\n' }],
    });
    expect(out).toMatchObject({ pr_number: 5 });
    expect(db.createdPrs[0].kind).toBe('patch');
  });
});

/* ── submit_findings ──────────────────────────────────────────────────────── */

describe('submit_findings', () => {
  it('emits the conclusion to the sink and acknowledges', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const { ctx, sink } = makeCtx({ incident });
    const out = await submitFindings(ctx, {
      root_cause: 'Null deref from bad deploy 1faea62',
      evidence: [{ type: 'tool', tool: 'get_deploy_diff', ref: '1faea62' }],
      confidence: 0.9,
      decision: 'propose_fix',
    });
    expect(out).toEqual({ acknowledged: true });
    expect(sink.conclusionCalls).toEqual([
      { root_cause: 'Null deref from bad deploy 1faea62', confidence: 0.9, decision: 'propose_fix' },
    ]);
  });
});

/* ── registry ─────────────────────────────────────────────────────────────── */

describe('tool registry', () => {
  it('registers exactly the 7 allowlisted tools; 5 are read-only', () => {
    expect(TOOL_DEFINITIONS.map((d) => d.name).sort()).toEqual(
      ['create_fix_pr', 'get_deploy_diff', 'get_metrics', 'get_recent_deploys', 'read_file', 'search_logs', 'submit_findings'],
    );
    expect(READONLY_TOOL_NAMES).not.toContain('create_fix_pr');
    expect(READONLY_TOOL_NAMES).not.toContain('submit_findings');
  });

  it('runTool validates input against the schema (rejects malformed)', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const { ctx } = makeCtx({ incident });
    // limit above the 50 cap is a schema violation
    await expect(runTool(ctx, 'search_logs', { limit: 999 })).rejects.toThrow();
    // create_fix_pr revert without revert_sha violates the refinement
    await expect(
      runTool(ctx, 'create_fix_pr', { kind: 'revert', confidence: 0.9, root_cause: 'x', title: 't', body: 'b' }),
    ).rejects.toThrow();
  });

  it('runTool dispatches a valid read tool', async () => {
    const incident = makeIncident({ customer_id: CUS });
    const db = makeFakeDb({ logs: [log({ message: 'hi' })] }, incident);
    const { ctx } = makeCtx({ db, incident });
    const out = (await runTool(ctx, 'search_logs', { service: 'checkout-api' })) as { returned: number };
    expect(out.returned).toBe(1);
  });
});
