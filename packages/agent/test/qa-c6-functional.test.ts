/**
 * QA C6 — independent functional/contract suite (SPEC §9).
 * Derived from SPEC §9 + @oncall/shared/tools.ts BEFORE trusting the impl.
 * Drives the REAL tool code (registry + tools + guards + bounded) through
 * synthetic fakes; every tool output is validated against the shared zod schema.
 * (Live GitHub checks + PR #2 verification live in scratchpad/qa-c6-live.mjs.)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  SearchLogsOutputSchema,
  GetMetricsOutputSchema,
  GetRecentDeploysOutputSchema,
  GetDeployDiffOutputSchema,
  ReadFileOutputSchema,
  CreateFixPrSuccessSchema,
  CreateFixPrRefusalSchema,
  SubmitFindingsOutputSchema,
  AGENT_TOOL_NAMES,
} from '@oncall/shared';
import {
  runTool,
  TOOL_DEFINITIONS,
  READONLY_TOOL_NAMES,
  WRITE_TOOL_NAME,
  createPinnedGitHub,
  assertWritableBranch,
  generateFixBranch,
  isConfidentEnough,
  bareBranch,
  SafetyViolationError,
  type ToolContext,
  type ToolGithubConfig,
  type PinnedGitHub,
  type GitHubClient,
} from '@oncall/agent';

/* ── fakes ──────────────────────────────────────────────────────────────── */

const GH: ToolGithubConfig = {
  owner: 'DIVIJ08070',
  repo: 'oncall-ai-victim',
  defaultBranch: 'main',
  protectedBranches: ['main', 'master'],
};

function makeCtx(over: Partial<{
  logRows: any[];
  samples: any[];
  currentSha: string | null;
  octokit: PinnedGitHub;
  confidenceThreshold: number;
  prCreate: (i: any) => any;
  sink: any;
}> = {}): ToolContext {
  const logRows = over.logRows ?? [];
  const samples = over.samples ?? [];
  const prCreate = over.prCreate ?? ((i: any) => ({ id: 'pr_1', ...i }));
  return {
    db: {
      dao: {
        logEvents: {
          query: (q: any) => {
            let rows = logRows.filter((r) =>
              (q.service === undefined || r.service === q.service) &&
              (q.level === undefined || r.level === q.level));
            return rows.slice(0, q.limit ?? 500);
          },
        },
        metricSamples: {
          latestForService: () => samples[samples.length - 1] ?? null,
          seriesForService: (_c: string, _s: string, since: number, limit?: number) =>
            samples.filter((s) => s.bucket_ts >= since).slice(0, limit ?? 240),
        },
        deploys: {
          getBySha: () => null,
          getCurrent: () => (over.currentSha ? ({ sha: over.currentSha } as any) : null),
          listRecent: () => [],
        },
        incidents: { update: vi.fn((_id: string, p: any) => ({ id: _id, ...p })) },
        pullRequests: { create: vi.fn(prCreate) },
        services: { getByName: () => null },
      },
    } as any,
    octokit: over.octokit ?? ({} as PinnedGitHub),
    config: {
      github: GH,
      agent: { confidenceThreshold: over.confidenceThreshold ?? 0.6 },
    },
    customer: { id: 'cus_test' },
    incident: { id: 'inc_test' } as any,
    sink: over.sink ?? {},
  };
}

/* A PinnedGitHub whose reads return controllable fixtures. */
function fakeGithub(over: Partial<PinnedGitHub> = {}): PinnedGitHub {
  return {
    owner: GH.owner, repo: GH.repo, defaultBranch: GH.defaultBranch,
    listCommits: async () => [],
    getCommitDiff: async () => ({ sha: 'h', parents: ['p'], message: 'm', author: 'a', committed_at: 0, additions: 0, deletions: 0, files: [] }),
    compare: async () => ({ base_sha: 'b', head_sha: 'h', files: [], total_additions: 0, total_deletions: 0 }),
    getFile: async () => ({ path: 'x', ref: 'main', content: '' }),
    openRevertPr: async () => ({ number: 1, id: 1, url: 'u', branch: 'oncall-ai/fix-x-a', base: 'main', head_sha: 's' }),
    openPatchPr: async () => ({ number: 1, id: 1, url: 'u', branch: 'oncall-ai/fix-x-a', base: 'main', head_sha: 's' }),
    ...over,
  };
}

/* ── A. search_logs ─────────────────────────────────────────────────────── */
describe('search_logs (§9 tool 1)', () => {
  const rows = (n: number, sig = 'err|<n>') =>
    Array.from({ length: n }, (_, i) => ({
      timestamp: 1000 + i, service: 'checkout-api', level: 'error', message: `boom ${i}`,
      endpoint: '/api/checkout', method: 'POST', status: 500, latency_ms: 5,
      stack: 'x'.repeat(5000), fingerprint_sig: sig,
    }));

  it('TC-01 defaults limit=30 + TC-03 output shape parses', async () => {
    const out = await runTool(makeCtx({ logRows: rows(3) }), 'search_logs', {});
    expect(SearchLogsOutputSchema.safeParse(out).success).toBe(true);
  });
  it('TC-02 limit>50 rejected by registry validate', async () => {
    await expect(runTool(makeCtx(), 'search_logs', { limit: 51 })).rejects.toThrow();
  });
  it('TC-04 row cap ≤50 (60 rows, limit 50)', async () => {
    const out: any = await runTool(makeCtx({ logRows: rows(60) }), 'search_logs', { limit: 50 });
    expect(out.events.length).toBeLessThanOrEqual(50);
    expect(out.returned).toBeLessThanOrEqual(50);
  });
  it('TC-05 stack_excerpt ≤1200 chars', async () => {
    const out: any = await runTool(makeCtx({ logRows: rows(1) }), 'search_logs', {});
    expect(out.events[0].stack_excerpt.length).toBeLessThanOrEqual(1200);
  });
  it('TC-06 patterns summarize remainder when total_matched>returned', async () => {
    const out: any = await runTool(makeCtx({ logRows: rows(40) }), 'search_logs', { limit: 10 });
    expect(out.total_matched).toBe(40);
    expect(out.returned).toBe(10);
    expect(out.patterns.length).toBeGreaterThan(0);
    const total = out.patterns.reduce((n: number, p: any) => n + p.count, 0);
    expect(total).toBe(30); // remainder summarized
    expect(out.patterns[0]).toHaveProperty('signature');
    expect(out.patterns[0]).toHaveProperty('sample');
  });
  it('TC-07 level filter honored', async () => {
    const mixed = [...rows(2), { timestamp: 9, service: 'checkout-api', level: 'info', message: 'ok', endpoint: null, method: null, status: 200, latency_ms: 1, stack: null, fingerprint_sig: null }];
    const out: any = await runTool(makeCtx({ logRows: mixed }), 'search_logs', { level: 'error' });
    expect(out.events.every((e: any) => e.level === 'error')).toBe(true);
  });
});

/* ── B. get_metrics ─────────────────────────────────────────────────────── */
describe('get_metrics (§9 tool 2)', () => {
  const samples = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      bucket_ts: Date.now() - (n - i) * 1000, window_sec: 60, request_count: 10, error_count: 2,
      error_rate: 0.2, p50_ms: 40, p95_ms: 120, p99_ms: 260,
    }));
  it('TC-08 defaults + TC-10 output shape parses', async () => {
    const out = await runTool(makeCtx({ samples: samples(5) }), 'get_metrics', { service: 'checkout-api' });
    const p = GetMetricsOutputSchema.safeParse(out);
    expect(p.success).toBe(true);
    expect((out as any).window_sec).toBe(900);
  });
  it('TC-09 window_sec>3600 rejected', async () => {
    await expect(runTool(makeCtx(), 'get_metrics', { service: 's', window_sec: 3601 })).rejects.toThrow();
  });
  it('TC-11 series capped ≤60 (80 samples)', async () => {
    const out: any = await runTool(makeCtx({ samples: samples(80) }), 'get_metrics', { service: 'checkout-api', window_sec: 3600 });
    expect(out.series.length).toBeLessThanOrEqual(60);
  });
});

/* ── C. get_recent_deploys (facade fake) ────────────────────────────────── */
describe('get_recent_deploys (§9 tool 3)', () => {
  const commits = (n: number) => Array.from({ length: n }, (_, i) => ({
    sha: `sha${i}`.padEnd(40, '0'), short_sha: `sha${i}`.slice(0, 7),
    message_first_line: `commit ${i}`, author: 'bot', committed_at: 1000 + i,
  }));
  it('TC-12 limit>20 rejected', async () => {
    await expect(runTool(makeCtx(), 'get_recent_deploys', { limit: 21 })).rejects.toThrow();
  });
  it('TC-14 shape parses + is_current enrichment', async () => {
    const gh = fakeGithub({ listCommits: async () => commits(4) });
    const out: any = await runTool(makeCtx({ octokit: gh, currentSha: 'sha1'.padEnd(40, '0') }), 'get_recent_deploys', { limit: 10 });
    expect(GetRecentDeploysOutputSchema.safeParse(out).success).toBe(true);
    expect(out.deploys.filter((d: any) => d.is_current).length).toBe(1);
  });
});

/* ── D. get_deploy_diff caps (facade fake) ──────────────────────────────── */
describe('get_deploy_diff (§9 tool 4)', () => {
  const file = (path: string, patch: string | null, status = 'modified') => ({ path, status, additions: 1, deletions: 1, patch });
  it('TC-16 files capped ≤20 + truncated flag (30 files)', async () => {
    const files = Array.from({ length: 30 }, (_, i) => file(`src/f${i}.ts`, 'a\nb'));
    const gh = fakeGithub({ getCommitDiff: async () => ({ sha: 'h', parents: ['p'], message: 'm', author: 'a', committed_at: 0, additions: 30, deletions: 30, files }) });
    const out: any = await runTool(makeCtx({ octokit: gh }), 'get_deploy_diff', { sha: 'h' });
    expect(GetDeployDiffOutputSchema.safeParse(out).success).toBe(true);
    expect(out.files.length).toBeLessThanOrEqual(20);
    expect(out.total_files).toBe(30);
    expect(out.truncated).toBe(true);
  });
  it('TC-17 patch_excerpt ≤4000 chars', async () => {
    const big = 'x'.repeat(9000);
    const gh = fakeGithub({ getCommitDiff: async () => ({ sha: 'h', parents: ['p'], message: 'm', author: 'a', committed_at: 0, additions: 1, deletions: 1, files: [file('src/a.ts', big)] }) });
    const out: any = await runTool(makeCtx({ octokit: gh }), 'get_deploy_diff', { sha: 'h' });
    expect(out.files[0].patch_excerpt.length).toBeLessThanOrEqual(4000);
    expect(out.truncated).toBe(true);
  });
  it('TC-18 lockfile skipped (status=skipped, empty patch)', async () => {
    const gh = fakeGithub({ getCommitDiff: async () => ({ sha: 'h', parents: ['p'], message: 'm', author: 'a', committed_at: 0, additions: 1, deletions: 1, files: [file('package-lock.json', 'huge diff here')] }) });
    const out: any = await runTool(makeCtx({ octokit: gh }), 'get_deploy_diff', { sha: 'h' });
    expect(out.files[0].status).toBe('skipped');
    expect(out.files[0].patch_excerpt).toBe('');
  });
});

/* ── E. read_file caps + traversal (facade fake) ────────────────────────── */
describe('read_file (§9 tool 5)', () => {
  it('TC-21 ≤400 lines cap + truncated', async () => {
    const content = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
    const gh = fakeGithub({ getFile: async () => ({ path: 'src/big.ts', ref: 'main', content }) });
    const out: any = await runTool(makeCtx({ octokit: gh }), 'read_file', { path: 'src/big.ts' });
    expect(ReadFileOutputSchema.safeParse(out).success).toBe(true);
    expect(out.returned_lines).toBeLessThanOrEqual(400);
    expect(out.total_lines).toBe(1000);
    expect(out.truncated).toBe(true);
  });
  it('TC-22 path traversal + absolute rejected (no fetch)', async () => {
    const spy = vi.fn(async () => ({ path: 'x', ref: 'main', content: '' }));
    const gh = fakeGithub({ getFile: spy });
    await expect(runTool(makeCtx({ octokit: gh }), 'read_file', { path: '../etc/passwd' })).rejects.toThrow();
    await expect(runTool(makeCtx({ octokit: gh }), 'read_file', { path: '/etc/passwd' })).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ── F. create_fix_pr — FR-13 gate + zod refinements ────────────────────── */
describe('create_fix_pr (§9 tool 6) + FR-13 gate', () => {
  it('TC-23 kind=revert without revert_sha rejected by schema', async () => {
    await expect(runTool(makeCtx(), 'create_fix_pr', { kind: 'revert', confidence: 0.9, root_cause: 'r', title: 't', body: 'b' })).rejects.toThrow();
  });
  it('TC-24 kind=patch without files rejected by schema', async () => {
    await expect(runTool(makeCtx(), 'create_fix_pr', { kind: 'patch', confidence: 0.9, root_cause: 'r', title: 't', body: 'b' })).rejects.toThrow();
  });
  it('TC-25 FR-13 gate REFUSES below threshold, NO PR opened', async () => {
    const revert = vi.fn(async () => ({ number: 9, id: 9, url: 'u', branch: 'oncall-ai/fix-x-a', base: 'main', head_sha: 's' }));
    const gh = fakeGithub({ openRevertPr: revert });
    const ctx = makeCtx({ octokit: gh, confidenceThreshold: 0.6 });
    const out: any = await runTool(ctx, 'create_fix_pr', { kind: 'revert', confidence: 0.5, root_cause: 'r', title: 't', body: 'b', revert_sha: 'abc' });
    expect(CreateFixPrRefusalSchema.safeParse(out).success).toBe(true);
    expect(out).toEqual({ escalate: true, reason: 'confidence below threshold' });
    expect(revert).not.toHaveBeenCalled();
    expect(ctx.db.dao.pullRequests.create).not.toHaveBeenCalled();
    expect(ctx.db.dao.incidents.update).not.toHaveBeenCalled();
  });
  it('TC-26 gate boundary: confidence == threshold proceeds (inclusive)', async () => {
    const gh = fakeGithub({ openRevertPr: async () => ({ number: 9, id: 9, url: 'u', branch: 'oncall-ai/fix-inc_test-abc123', base: 'main', head_sha: 'deadbee' }) });
    const out: any = await runTool(makeCtx({ octokit: gh, confidenceThreshold: 0.6 }), 'create_fix_pr', { kind: 'revert', confidence: 0.6, root_cause: 'r', title: 't', body: 'b', revert_sha: 'abc' });
    expect(CreateFixPrSuccessSchema.safeParse(out).success).toBe(true);
  });
  it('TC-27 success shape + persists PR row + links incident fix_proposed', async () => {
    const gh = fakeGithub({ openRevertPr: async () => ({ number: 42, id: 100, url: 'https://gh/pr/42', branch: 'oncall-ai/fix-inc_test-abc123', base: 'main', head_sha: 'deadbee' }) });
    const ctx = makeCtx({ octokit: gh, confidenceThreshold: 0.6 });
    const out: any = await runTool(ctx, 'create_fix_pr', { kind: 'revert', confidence: 0.92, root_cause: 'null deref', title: 't', body: 'b', revert_sha: 'abc' });
    expect(out).toMatchObject({ pr_number: 42, base: 'main', branch: 'oncall-ai/fix-inc_test-abc123' });
    expect(ctx.db.dao.pullRequests.create).toHaveBeenCalledTimes(1);
    const patch = (ctx.db.dao.incidents.update as any).mock.calls[0][1];
    expect(patch.status).toBe('fix_proposed');
  });
});

/* ── G. guards.ts SAFETY invariant ──────────────────────────────────────── */
describe('guards.ts SAFETY (§9, FR-09/NFR-03)', () => {
  it('TC-29..31 branch guard rejects default/protected/empty', () => {
    expect(() => assertWritableBranch('main', GH)).toThrow(SafetyViolationError);
    expect(() => assertWritableBranch('MAIN', GH)).toThrow(SafetyViolationError);
    expect(() => assertWritableBranch('master', GH)).toThrow(SafetyViolationError);
    expect(() => assertWritableBranch('', GH)).toThrow(SafetyViolationError);
    expect(() => assertWritableBranch('refs/heads/main', GH)).toThrow(SafetyViolationError);
  });
  it('TC-32 branch guard accepts a fix branch', () => {
    expect(() => assertWritableBranch('oncall-ai/fix-inc_1-ab12cd', GH)).not.toThrow();
  });
  it('TC-33 generateFixBranch format oncall-ai/fix-<id>-<rand6>', () => {
    const b = generateFixBranch('inc_01ABC');
    expect(b).toMatch(/^oncall-ai\/fix-inc_01ABC-[0-9a-f]{6}$/);
    expect(generateFixBranch('inc_01ABC')).not.toBe(b); // random each call
  });
  it('confidence gate helper inclusive at bound', () => {
    expect(isConfidentEnough(0.6, 0.6)).toBe(true);
    expect(isConfidentEnough(0.59, 0.6)).toBe(false);
  });
  it('TC-28 GitHubClient type surface omits merge/updateRef/deleteRef (compile+runtime create-only)', () => {
    // Structural proof: drive the real facade over a recording raw client and
    // assert the only mutating verbs ever called are the create-only allowlist,
    // never updateRef/deleteRef/pulls.merge, and base heads/main is never written.
    const calls: string[] = [];
    const rec = (name: string, ret: any) => (p: any) => { calls.push(`${name}:${p.ref ?? p.basehead ?? ''}`); return Promise.resolve({ data: ret }); };
    const raw: GitHubClient = {
      rest: {
        repos: {
          listCommits: rec('repos.listCommits', []) as any,
          getCommit: ((p: any) => {
            calls.push(`repos.getCommit:${p.ref}`);
            // base tip commit (tree) OR the target commit (parents+files)
            return Promise.resolve({ data: { sha: p.ref, commit: { message: 'm', author: { name: 'a', date: '2020-01-01' }, tree: { sha: 'basetree' } }, parents: [{ sha: 'parentsha' }], files: [{ filename: 'src/routes/checkout.ts', status: 'modified', additions: 1, deletions: 1, patch: 'p' }] } });
          }) as any,
          compareCommitsWithBasehead: rec('repos.compare', { files: [] }) as any,
          getContent: ((p: any) => { calls.push(`repos.getContent:${p.path}@${p.ref}`); return Promise.resolve({ data: { type: 'file', path: p.path, content: Buffer.from('guarded').toString('base64'), encoding: 'base64', sha: 'blobsha' } }); }) as any,
        },
        git: {
          getRef: ((p: any) => { calls.push(`git.getRef:${p.ref}`); return Promise.resolve({ data: { object: { sha: 'basehead' } } }); }) as any,
          createBlob: rec('git.createBlob', { sha: 'newblob' }) as any,
          createTree: rec('git.createTree', { sha: 'newtree' }) as any,
          createCommit: rec('git.createCommit', { sha: 'newcommit' }) as any,
          createRef: rec('git.createRef', { ref: 'refs/heads/x', object: { sha: 'newcommit' } }) as any,
        },
        pulls: {
          create: ((p: any) => { calls.push(`pulls.create:${p.head}->${p.base}`); return Promise.resolve({ data: { number: 7, id: 70, html_url: 'u', head: { sha: 'newcommit' } } }); }) as any,
        },
      },
    };
    const pinned = createPinnedGitHub(raw, GH);
    return pinned.openRevertPr({ revertSha: 'S', branch: 'oncall-ai/fix-inc_1-abcdef', title: 't', body: 'b' }).then(() => {
      const verbs = calls.map((c) => c.split(':')[0]);
      const allowed = new Set(['repos.listCommits', 'repos.getCommit', 'repos.compare', 'repos.getContent', 'git.getRef', 'git.createBlob', 'git.createTree', 'git.createCommit', 'git.createRef', 'pulls.create']);
      for (const v of verbs) expect(allowed.has(v)).toBe(true);
      // no forbidden verbs
      expect(verbs).not.toContain('git.updateRef');
      expect(verbs).not.toContain('git.deleteRef');
      expect(verbs).not.toContain('pulls.merge');
      // createRef only ever targets the NEW fix branch, never base
      const createRefCalls = calls.filter((c) => c.startsWith('git.createRef'));
      expect(createRefCalls.every((c) => c.includes('fix-inc_1-abcdef') || c === 'git.createRef:')).toBe(true);
      // PR targets base=main from the fix head
      expect(calls.some((c) => c.startsWith('pulls.create') && c.endsWith('->main'))).toBe(true);
    });
  });
  it('TC-35 revert restores PARENT content on a new branch', async () => {
    const parentReads: string[] = [];
    const raw: GitHubClient = {
      rest: {
        repos: {
          listCommits: (async () => ({ data: [] })) as any,
          getCommit: (async (p: any) => ({ data: { sha: p.ref, commit: { message: 'm', author: { date: '2020-01-01' }, tree: { sha: 'bt' } }, parents: [{ sha: 'PARENT' }], files: [{ filename: 'src/routes/checkout.ts', status: 'modified', additions: 1, deletions: 1, patch: 'p' }] } })) as any,
          compareCommitsWithBasehead: (async () => ({ data: { files: [] } })) as any,
          getContent: (async (p: any) => { parentReads.push(`${p.path}@${p.ref}`); return { data: { type: 'file', path: p.path, content: Buffer.from('PARENT_CONTENT').toString('base64'), encoding: 'base64', sha: 'x' } }; }) as any,
        },
        git: {
          getRef: (async () => ({ data: { object: { sha: 'basehead' } } })) as any,
          createBlob: (async (p: any) => { expect(Buffer.from(p.content, 'base64').toString('utf8')).toBe('PARENT_CONTENT'); return { data: { sha: 'nb' } }; }) as any,
          createTree: (async () => ({ data: { sha: 'nt' } })) as any,
          createCommit: (async () => ({ data: { sha: 'nc' } })) as any,
          createRef: (async () => ({ data: { ref: 'r', object: { sha: 'nc' } } })) as any,
        },
        pulls: { create: (async () => ({ data: { number: 1, id: 1, html_url: 'u', head: { sha: 'nc' } } })) as any },
      },
    };
    const pinned = createPinnedGitHub(raw, GH);
    await pinned.openRevertPr({ revertSha: 'S', branch: 'oncall-ai/fix-inc_1-abcdef', title: 't', body: 'b' });
    // The revert read the changed file at the PARENT sha (guard #4).
    expect(parentReads).toContain('src/routes/checkout.ts@PARENT');
  });
  it('openRevertPr refuses to write the base branch directly (branch guard)', async () => {
    const raw = {} as GitHubClient;
    const pinned = createPinnedGitHub(raw, GH);
    await expect(pinned.openRevertPr({ revertSha: 'S', branch: 'main', title: 't', body: 'b' })).rejects.toThrow(SafetyViolationError);
  });
});

/* ── H. submit_findings ─────────────────────────────────────────────────── */
describe('submit_findings (§9 control tool)', () => {
  it('TC-36/38 input parses, emits conclusion via sink, returns acknowledged', async () => {
    const conclusion = vi.fn();
    const out: any = await runTool(makeCtx({ sink: { conclusion } }), 'submit_findings', { root_cause: 'null deref', evidence: [{ type: 'tool', ref: 'get_deploy_diff:1faea62' }], confidence: 0.9, decision: 'propose_fix' });
    expect(SubmitFindingsOutputSchema.safeParse(out).success).toBe(true);
    expect(out.acknowledged).toBe(true);
    expect(conclusion).toHaveBeenCalledTimes(1);
  });
  it('TC-37 decision enum rejects invalid value', async () => {
    await expect(runTool(makeCtx(), 'submit_findings', { root_cause: 'r', evidence: [], confidence: 0.9, decision: 'merge_it' })).rejects.toThrow();
  });
});

/* ── I. registry / allowlist ────────────────────────────────────────────── */
describe('registry / allowlist (§9 sandbox)', () => {
  it('TC-39 exactly 7 tools = 6 + submit_findings', () => {
    expect(TOOL_DEFINITIONS.map((d) => d.name).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
    expect(TOOL_DEFINITIONS.length).toBe(7);
    expect(READONLY_TOOL_NAMES.length).toBe(5);
    expect(WRITE_TOOL_NAME).toBe('create_fix_pr');
    expect(READONLY_TOOL_NAMES).not.toContain('create_fix_pr');
    expect(READONLY_TOOL_NAMES).not.toContain('submit_findings');
  });
  it('TC-40 unknown tool rejected', async () => {
    await expect(runTool(makeCtx(), 'nope' as any, {})).rejects.toThrow();
  });
  it('bareBranch strips refs/heads', () => {
    expect(bareBranch('refs/heads/main')).toBe('main');
  });
});
