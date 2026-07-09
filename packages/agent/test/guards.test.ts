import { describe, it, expect } from 'vitest';
import {
  SafetyViolationError,
  assertWritableBranch,
  bareBranch,
  createPinnedGitHub,
  generateFixBranch,
  isConfidentEnough,
} from '../src/guards.js';
import {
  SearchLogsInputSchema,
  GetDeployDiffInputSchema,
  ReadFileInputSchema,
  CreateFixPrInputSchema,
  GetRecentDeploysInputSchema,
} from '@oncall/shared';
import { PINNED, makeConfig, makeFakeGitHub, type RecordedCall } from './helpers.js';

/**
 * NEGATIVE safety tests — prove the SAFETY invariant (SPEC §9, FR-09/NFR-03) is
 * enforced in CODE and makes it *structurally impossible* to push to a protected
 * branch or target another repo.
 */

const ALLOWED_ENDPOINTS = new Set([
  'repos.listCommits',
  'repos.getCommit',
  'repos.compareCommitsWithBasehead',
  'repos.getContent',
  'git.getRef',
  'git.createBlob',
  'git.createTree',
  'git.createCommit',
  'git.createRef',
  'pulls.create',
]);

const FORBIDDEN_ENDPOINTS = ['git.updateRef', 'git.deleteRef', 'pulls.merge', 'repos.merge'];

function assertAllPinned(calls: RecordedCall[]): void {
  for (const c of calls) {
    expect(c.owner, `${c.ep} owner`).toBe(PINNED.owner);
    expect(c.repo, `${c.ep} repo`).toBe(PINNED.repo);
  }
}

/* ── guard #2: branch guard ───────────────────────────────────────────────── */

describe('assertWritableBranch — refuses default/protected/empty (guard #2)', () => {
  const github = makeConfig().github;

  it.each(['main', 'master', 'MAIN', 'Master', 'refs/heads/main', 'heads/master'])(
    'throws on protected/default branch %s',
    (name) => {
      expect(() => assertWritableBranch(name, github)).toThrow(SafetyViolationError);
    },
  );

  it.each(['', '   ', 'refs/heads/'])('throws on empty branch %p', (name) => {
    expect(() => assertWritableBranch(name, github)).toThrow(SafetyViolationError);
  });

  it('accepts a generated fix branch', () => {
    expect(() =>
      assertWritableBranch('oncall-ai/fix-inc_01H-a1b2c3', github),
    ).not.toThrow();
  });

  it('bareBranch strips ref prefixes', () => {
    expect(bareBranch('refs/heads/foo')).toBe('foo');
    expect(bareBranch('heads/foo')).toBe('foo');
    expect(bareBranch('foo')).toBe('foo');
  });
});

describe('generateFixBranch', () => {
  it('produces oncall-ai/fix-<incident>-<rand6> that always passes the guard', () => {
    const github = makeConfig().github;
    for (let i = 0; i < 50; i++) {
      const b = generateFixBranch('inc_01HXYZ');
      expect(b).toMatch(/^oncall-ai\/fix-inc_01HXYZ-[0-9a-f]{6}$/);
      expect(() => assertWritableBranch(b, github)).not.toThrow();
    }
  });

  it('is unique across calls (fresh rand6)', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateFixBranch('inc_X')));
    expect(seen.size).toBe(200);
  });
});

/* ── FR-13 confidence gate helper ─────────────────────────────────────────── */

describe('isConfidentEnough (FR-13 gate)', () => {
  it('is inclusive at the threshold', () => {
    expect(isConfidentEnough(0.6, 0.6)).toBe(true);
    expect(isConfidentEnough(0.59, 0.6)).toBe(false);
    expect(isConfidentEnough(0.61, 0.6)).toBe(true);
  });
});

/* ── guard #1: repo pinning — no tool input carries owner/repo ─────────────── */

describe('repo pinning — tool schemas expose NO owner/repo field (guard #1)', () => {
  it.each([
    ['search_logs', SearchLogsInputSchema],
    ['get_recent_deploys', GetRecentDeploysInputSchema],
    ['read_file', ReadFileInputSchema],
    ['create_fix_pr', CreateFixPrInputSchema],
  ] as const)('%s input has no owner/repo/owner-like key', (_name, schema) => {
    // Parsing an input that smuggles owner/repo must NOT surface them (stripped).
    const base: Record<string, unknown> = { owner: 'attacker', repo: 'evil' };
    let parsed: Record<string, unknown> = {};
    // Build a minimally-valid input per schema, plus the smuggled keys.
    if (schema === CreateFixPrInputSchema) {
      parsed = (
        CreateFixPrInputSchema.parse({
          ...base,
          kind: 'revert',
          confidence: 0.9,
          root_cause: 'x',
          title: 't',
          body: 'b',
          revert_sha: 'abc',
        }) as unknown
      ) as Record<string, unknown>;
    } else if (schema === ReadFileInputSchema) {
      parsed = ReadFileInputSchema.parse({ ...base, path: 'src/a.ts' }) as Record<string, unknown>;
    } else {
      parsed = (schema as typeof SearchLogsInputSchema).parse({ ...base }) as Record<string, unknown>;
    }
    expect(parsed.owner).toBeUndefined();
    expect(parsed.repo).toBeUndefined();
  });

  it('every GitHub call the pinned facade makes uses the pinned owner/repo only', async () => {
    const github = makeFakeGitHub({
      commitList: [{ sha: 'deadbeef00', message: 'seed' }],
    });
    const pinned = createPinnedGitHub(github.client, PINNED);
    await pinned.listCommits({ limit: 5 });
    assertAllPinned(github.calls);
    // The facade exposes no owner/repo argument — pinning is by construction.
    expect(pinned.owner).toBe(PINNED.owner);
    expect(pinned.repo).toBe(PINNED.repo);
  });

  it('a different config repints the facade — impossible to reach the victim repo from a foo/bar pin', async () => {
    const github = makeFakeGitHub({ commitList: [{ sha: 'x', message: 'm' }] });
    const pinned = createPinnedGitHub(github.client, {
      owner: 'foo',
      repo: 'bar',
      defaultBranch: 'main',
      protectedBranches: ['main'],
    });
    await pinned.listCommits({ limit: 1 });
    for (const c of github.calls) {
      expect(c.owner).toBe('foo');
      expect(c.repo).toBe('bar');
    }
  });
});

/* ── guard #3: create-only write path ─────────────────────────────────────── */

describe('create-only write path — no merge/force/base-write reachable (guard #3)', () => {
  const revertSeed = {
    refs: { 'heads/main': 'baseSha' },
    commits: {
      baseSha: { treeSha: 'baseTree', parents: ['prevSha'], files: [] },
      revertSha: {
        parents: ['parentSha'],
        files: [
          {
            filename: 'src/routes/checkout.ts',
            status: 'modified',
            additions: 1,
            deletions: 1,
            patch: '@@ -1 +1 @@\n-  if (cart) return cart.items;\n+  return cart.items;',
          },
        ],
      },
    },
    contents: { 'parentSha:src/routes/checkout.ts': 'export const guard = true;\n' },
    prNumber: 7,
    prId: 555,
  };

  it('the facade object exposes NO merge/updateRef/deleteRef method', () => {
    const { client } = makeFakeGitHub(revertSeed);
    const pinned = createPinnedGitHub(client, PINNED);
    for (const forbidden of ['merge', 'updateRef', 'deleteRef', 'push', 'forcePush']) {
      expect((pinned as unknown as Record<string, unknown>)[forbidden]).toBeUndefined();
    }
  });

  it('openRevertPr only ever calls allowlisted create/read endpoints', async () => {
    const github = makeFakeGitHub(revertSeed);
    const pinned = createPinnedGitHub(github.client, PINNED);
    await pinned.openRevertPr({
      revertSha: 'revertSha',
      branch: 'oncall-ai/fix-inc_1-aaa111',
      title: 'Revert bad deploy',
      body: 'diagnostic',
    });
    assertAllPinned(github.calls);
    const endpoints = github.calls.map((c) => c.ep);
    for (const ep of endpoints) expect(ALLOWED_ENDPOINTS.has(ep), ep).toBe(true);
    for (const forbidden of FORBIDDEN_ENDPOINTS) {
      expect(endpoints).not.toContain(forbidden);
    }
    // No force flag anywhere.
    for (const c of github.calls) {
      expect((c.params as { force?: unknown }).force).toBeUndefined();
    }
  });

  it('openRevertPr REFUSES to build onto a protected branch (structural push-to-main block)', async () => {
    const github = makeFakeGitHub(revertSeed);
    const pinned = createPinnedGitHub(github.client, PINNED);
    await expect(
      pinned.openRevertPr({
        revertSha: 'revertSha',
        branch: 'main',
        title: 't',
        body: 'b',
      }),
    ).rejects.toThrow(SafetyViolationError);
    // Refused BEFORE any GitHub write (assertWritableBranch runs first).
    expect(github.calls).toHaveLength(0);
  });

  it('openPatchPr also refuses a protected branch and never force-pushes', async () => {
    const github = makeFakeGitHub({ refs: { 'heads/main': 'baseSha' } });
    const pinned = createPinnedGitHub(github.client, PINNED);
    await expect(
      pinned.openPatchPr({
        files: [{ path: 'src/a.ts', content: 'x' }],
        branch: 'master',
        title: 't',
        body: 'b',
      }),
    ).rejects.toThrow(SafetyViolationError);
    expect(github.calls).toHaveLength(0);
  });
});

/* ── guard #4: revert algorithm restores parent content ───────────────────── */

describe('revert algorithm (guard #4) — restores each changed file to its parent content', () => {
  it('reads S + parent P, writes P-content on a new branch, opens the PR onto base', async () => {
    const parentContent = 'export function checkout(cart){ if(!cart) throw new Error("no cart"); return cart.items; }\n';
    const github = makeFakeGitHub({
      refs: { 'heads/main': 'baseHeadSha' },
      commits: {
        baseHeadSha: { treeSha: 'baseTreeSha', parents: ['x'], files: [] },
        badSha: {
          parents: ['parentSha'],
          files: [
            {
              filename: 'src/routes/checkout.ts',
              status: 'modified',
              additions: 1,
              deletions: 1,
              patch: '@@',
            },
          ],
        },
      },
      contents: { 'parentSha:src/routes/checkout.ts': parentContent },
      prNumber: 11,
      prId: 222,
    });
    const pinned = createPinnedGitHub(github.client, PINNED);
    const res = await pinned.openRevertPr({
      revertSha: 'badSha',
      branch: 'oncall-ai/fix-inc_9-bbb222',
      title: 'Revert null-guard removal',
      body: 'report',
    });

    // read the parent content of the file S changed
    const getContent = github.calls.find((c) => c.ep === 'repos.getContent');
    expect(getContent?.params).toMatchObject({ path: 'src/routes/checkout.ts', ref: 'parentSha' });

    // blob is the base64 of the PARENT content (guard #4)
    const createBlob = github.calls.find((c) => c.ep === 'git.createBlob');
    expect(createBlob?.params.content).toBe(Buffer.from(parentContent, 'utf8').toString('base64'));
    expect(createBlob?.params.encoding).toBe('base64');

    // tree builds on the CURRENT base tree, restoring the one file
    const createTree = github.calls.find((c) => c.ep === 'git.createTree');
    expect(createTree?.params.base_tree).toBe('baseTreeSha');
    expect(createTree?.params.tree).toEqual([
      { path: 'src/routes/checkout.ts', mode: '100644', type: 'blob', sha: 'blob-1' },
    ]);

    // commit parents = current base HEAD (not the bad commit)
    const createCommit = github.calls.find((c) => c.ep === 'git.createCommit');
    expect(createCommit?.params.parents).toEqual(['baseHeadSha']);

    // branch created (not updated) at the new commit; PR head=branch base=main
    const createRef = github.calls.find((c) => c.ep === 'git.createRef');
    expect(createRef?.params.ref).toBe('refs/heads/oncall-ai/fix-inc_9-bbb222');
    const pull = github.calls.find((c) => c.ep === 'pulls.create');
    expect(pull?.params).toMatchObject({ head: 'oncall-ai/fix-inc_9-bbb222', base: 'main' });

    expect(res).toMatchObject({ number: 11, id: 222, branch: 'oncall-ai/fix-inc_9-bbb222', base: 'main' });
  });

  it('a file ADDED by S is deleted on revert (sha:null in the tree)', async () => {
    const github = makeFakeGitHub({
      refs: { 'heads/main': 'baseHeadSha' },
      commits: {
        baseHeadSha: { treeSha: 'baseTreeSha', parents: ['x'], files: [] },
        addSha: {
          parents: ['parentSha'],
          files: [{ filename: 'src/new.ts', status: 'added', additions: 10, deletions: 0 }],
        },
      },
      prNumber: 12,
    });
    const pinned = createPinnedGitHub(github.client, PINNED);
    await pinned.openRevertPr({
      revertSha: 'addSha',
      branch: 'oncall-ai/fix-inc_9-ccc333',
      title: 't',
      body: 'b',
    });
    const createTree = github.calls.find((c) => c.ep === 'git.createTree');
    expect(createTree?.params.tree).toEqual([
      { path: 'src/new.ts', mode: '100644', type: 'blob', sha: null },
    ]);
    // No blob is created for a deletion, and no getContent for the added file.
    expect(github.calls.find((c) => c.ep === 'git.createBlob')).toBeUndefined();
  });
});
