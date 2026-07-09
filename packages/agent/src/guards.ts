import { randomBytes } from 'node:crypto';
import type {
  PinnedCommitDetail,
  PinnedCommitSummary,
  PinnedCompare,
  PinnedDiffFile,
  PinnedFileContent,
  PinnedGitHub,
  PinnedPrResult,
  ToolGithubConfig,
} from './ports.js';

/**
 * SAFETY invariant (SPEC §9, FR-09 / NFR-03) — enforced in **code, not prompt**.
 *
 * 1. **Repo pinning.** owner/repo come ONLY from config (`GITHUB_OWNER` /
 *    `GITHUB_REPO`). The pinned client bakes them in; no method accepts an
 *    owner/repo argument, so targeting another repo is impossible by
 *    construction.
 * 2. **Branch guard.** `assertWritableBranch` throws on the default/protected/
 *    empty branch. Fix branches are auto-generated `oncall-ai/fix-<inc>-<rand6>`.
 * 3. **Create-only write path.** The only mutating GitHub verbs reachable are
 *    `git.createBlob/createTree/createCommit/createRef` (on the NEW branch) +
 *    `pulls.create`. The narrow `GitHubClient` surface below **does not even
 *    expose** `git.updateRef` on base, `git.deleteRef`, force-push, or
 *    `pulls.merge` — merging is physically absent from the codebase.
 * 4. **Revert algorithm** (§9.4): for `revert_sha=S`, fetch S + its parent P;
 *    for each file S changed, write its content at P onto the new branch.
 */

/* ── The narrow raw-client surface the facade is allowed to touch ──────────── */

export interface RawCommitListItem {
  sha: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
    committer?: { date?: string } | null;
  };
  author?: { login?: string } | null;
}

export interface RawDiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  previous_filename?: string;
}

export interface RawCommit {
  sha: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
    tree: { sha: string };
  };
  author?: { login?: string } | null;
  parents: { sha: string }[];
  files?: RawDiffFile[];
  stats?: { additions: number; deletions: number };
}

export interface RawCompare {
  base_commit?: { sha: string };
  files?: RawDiffFile[];
}

export interface RawFileContent {
  type: string;
  path: string;
  content?: string;
  encoding?: string;
  sha: string;
}

/**
 * The **only** GitHub verbs the agent's write path may use. This is the
 * defense-in-depth twin of the runtime guards: `updateRef`, `deleteRef`, and
 * `pulls.merge` are intentionally **not on this type**, so no tool code can even
 * name them. The real `@octokit/rest` `Octokit` is a superset — pass it as
 * `octokit.rest as unknown as GitHubClient['rest']` at the server boundary.
 */
export interface GitHubClient {
  rest: {
    repos: {
      listCommits(p: {
        owner: string;
        repo: string;
        sha?: string;
        per_page?: number;
      }): Promise<{ data: RawCommitListItem[] }>;
      getCommit(p: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: RawCommit }>;
      compareCommitsWithBasehead(p: {
        owner: string;
        repo: string;
        basehead: string;
      }): Promise<{ data: RawCompare }>;
      getContent(p: {
        owner: string;
        repo: string;
        path: string;
        ref?: string;
      }): Promise<{ data: RawFileContent | RawFileContent[] }>;
    };
    git: {
      getRef(p: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: { object: { sha: string } } }>;
      createBlob(p: {
        owner: string;
        repo: string;
        content: string;
        encoding: string;
      }): Promise<{ data: { sha: string } }>;
      createTree(p: {
        owner: string;
        repo: string;
        base_tree: string;
        tree: {
          path: string;
          mode: string;
          type: string;
          sha?: string | null;
          content?: string;
        }[];
      }): Promise<{ data: { sha: string } }>;
      createCommit(p: {
        owner: string;
        repo: string;
        message: string;
        tree: string;
        parents: string[];
      }): Promise<{ data: { sha: string } }>;
      createRef(p: {
        owner: string;
        repo: string;
        ref: string;
        sha: string;
      }): Promise<{ data: { ref: string; object: { sha: string } } }>;
    };
    pulls: {
      create(p: {
        owner: string;
        repo: string;
        title: string;
        head: string;
        base: string;
        body: string;
      }): Promise<{
        data: { number: number; id: number; html_url: string; head: { sha: string } };
      }>;
    };
  };
}

/* ── Branch guard (SPEC §9 guard #2) ──────────────────────────────────────── */

export class SafetyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyViolationError';
  }
}

/** Strip a leading `refs/heads/` or `heads/` so guards compare bare names. */
export function bareBranch(name: string): string {
  return name.replace(/^refs\/heads\//, '').replace(/^heads\//, '');
}

/**
 * Throw unless `name` is a safe, writable branch: non-empty, not the default
 * branch, not in the protected denylist (SPEC §9 guard #2). Case-insensitive on
 * the protected comparison so `MAIN` can't slip through.
 */
export function assertWritableBranch(name: string, github: ToolGithubConfig): void {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new SafetyViolationError('branch name is empty');
  }
  const bare = bareBranch(name.trim());
  if (bare === '') {
    throw new SafetyViolationError('branch name is empty after normalization');
  }
  const denylist = new Set(
    [github.defaultBranch, ...github.protectedBranches].map((b) =>
      bareBranch(b).toLowerCase(),
    ),
  );
  if (denylist.has(bare.toLowerCase())) {
    throw new SafetyViolationError(
      `refusing to write protected branch "${bare}" (default/protected only accept human merges)`,
    );
  }
}

/** Auto-generate a fresh fix branch: `oncall-ai/fix-<incidentId>-<rand6>` (§9). */
export function generateFixBranch(incidentId: string): string {
  const rand6 = randomBytes(4).toString('hex').slice(0, 6);
  const safeIncident = incidentId.replace(/[^A-Za-z0-9_.-]/g, '');
  return `oncall-ai/fix-${safeIncident}-${rand6}`;
}

/* ── Confidence gate (SPEC §9 FR-13) ──────────────────────────────────────── */

/** True when `confidence` clears the FR-13 escalation threshold. */
export function isConfidentEnough(confidence: number, threshold: number): boolean {
  return confidence >= threshold;
}

/* ── Pinned GitHub facade (SPEC §9 guards #1, #3, #4) ──────────────────────── */

const FILE_MODE = '100644';

function firstLine(message: string): string {
  const nl = message.indexOf('\n');
  return nl === -1 ? message : message.slice(0, nl);
}

function toMs(date: string | undefined): number {
  if (!date) return 0;
  const t = Date.parse(date);
  return Number.isNaN(t) ? 0 : t;
}

function authorOf(c: {
  author?: { login?: string } | null;
  commit: { author: { name?: string } | null };
}): string {
  return c.author?.login ?? c.commit.author?.name ?? 'unknown';
}

function mapDiffFiles(files: RawDiffFile[] | undefined): PinnedDiffFile[] {
  return (files ?? []).map((f) => ({
    path: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch ?? null,
  }));
}

function decodeContent(data: RawFileContent): string {
  if (data.type !== 'file' || data.content === undefined) {
    throw new SafetyViolationError(`path "${data.path}" is not a readable file`);
  }
  const encoding = (data.encoding ?? 'base64') as BufferEncoding;
  return Buffer.from(data.content, encoding).toString('utf8');
}

/**
 * Construct the repo-pinned GitHub facade. owner/repo are captured here (SPEC §9
 * guard #1) and are the ONLY owner/repo values ever sent to GitHub.
 */
export function createPinnedGitHub(
  client: GitHubClient,
  github: ToolGithubConfig,
): PinnedGitHub {
  const owner = github.owner;
  const repo = github.repo;
  const base = github.defaultBranch;

  /** Read raw file content at a ref (used by the revert; keeps base64 for blobs). */
  async function rawContentAt(
    path: string,
    ref: string,
  ): Promise<{ base64: string } | { deleted: true }> {
    try {
      const res = await client.rest.repos.getContent({ owner, repo, path, ref });
      const data = res.data;
      if (Array.isArray(data) || data.type !== 'file' || data.content === undefined) {
        throw new SafetyViolationError(`path "${path}" is not a file at ${ref}`);
      }
      return { base64: data.content };
    } catch (err: unknown) {
      // File absent at the parent → it was *added* by S → revert = delete it.
      if (isNotFound(err)) return { deleted: true };
      throw err;
    }
  }

  return {
    owner,
    repo,
    defaultBranch: base,

    async listCommits({ limit, ref }): Promise<PinnedCommitSummary[]> {
      const res = await client.rest.repos.listCommits({
        owner,
        repo,
        sha: ref ?? base,
        per_page: Math.min(Math.max(limit, 1), 100),
      });
      return res.data.map((c) => ({
        sha: c.sha,
        short_sha: c.sha.slice(0, 7),
        message_first_line: firstLine(c.commit.message),
        author: authorOf(c),
        committed_at: toMs(c.commit.author?.date ?? c.commit.committer?.date),
      }));
    },

    async getCommitDiff(sha): Promise<PinnedCommitDetail> {
      const res = await client.rest.repos.getCommit({ owner, repo, ref: sha });
      const c = res.data;
      const files = mapDiffFiles(c.files);
      return {
        sha: c.sha,
        parents: c.parents.map((p) => p.sha),
        message: firstLine(c.commit.message),
        author: authorOf(c),
        committed_at: toMs(c.commit.author?.date),
        additions: c.stats?.additions ?? files.reduce((n, f) => n + f.additions, 0),
        deletions: c.stats?.deletions ?? files.reduce((n, f) => n + f.deletions, 0),
        files,
      };
    },

    async compare(baseRef, headRef): Promise<PinnedCompare> {
      const res = await client.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${baseRef}...${headRef}`,
      });
      const files = mapDiffFiles(res.data.files);
      return {
        base_sha: res.data.base_commit?.sha ?? baseRef,
        head_sha: headRef,
        files,
        total_additions: files.reduce((n, f) => n + f.additions, 0),
        total_deletions: files.reduce((n, f) => n + f.deletions, 0),
      };
    },

    async getFile(path, ref): Promise<PinnedFileContent> {
      const usedRef = ref ?? base;
      const res = await client.rest.repos.getContent({ owner, repo, path, ref: usedRef });
      if (Array.isArray(res.data)) {
        throw new SafetyViolationError(`path "${path}" is a directory, not a file`);
      }
      return { path, ref: usedRef, content: decodeContent(res.data) };
    },

    /* ── the ONLY write paths — create-only, new branch, PR onto base ──────── */

    async openRevertPr({ revertSha, branch, title, body }): Promise<PinnedPrResult> {
      // Guard #2: the target branch must be writable (never default/protected).
      assertWritableBranch(branch, github);

      // Base tip + its tree (the new commit builds on top of current base HEAD).
      const baseRef = await client.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
      const baseSha = baseRef.data.object.sha;
      const baseCommit = await client.rest.repos.getCommit({ owner, repo, ref: baseSha });
      const baseTreeSha = baseCommit.data.commit.tree.sha;

      // Guard #4: S + parent P; restore each file S changed to its content at P.
      const target = await client.rest.repos.getCommit({ owner, repo, ref: revertSha });
      const parentSha = target.data.parents[0]?.sha;
      if (!parentSha) {
        throw new SafetyViolationError(
          `cannot revert ${revertSha}: it has no parent commit`,
        );
      }
      const changed = target.data.files ?? [];
      if (changed.length === 0) {
        throw new SafetyViolationError(`commit ${revertSha} changed no files to revert`);
      }

      const tree: {
        path: string;
        mode: string;
        type: string;
        sha?: string | null;
        content?: string;
      }[] = [];
      for (const f of changed) {
        const path = f.filename;
        if (f.status === 'added') {
          // S added it → revert deletes it (sha:null removes from tree).
          tree.push({ path, mode: FILE_MODE, type: 'blob', sha: null });
          continue;
        }
        const at = await rawContentAt(path, parentSha);
        if ('deleted' in at) {
          tree.push({ path, mode: FILE_MODE, type: 'blob', sha: null });
          continue;
        }
        const blob = await client.rest.git.createBlob({
          owner,
          repo,
          content: at.base64,
          encoding: 'base64',
        });
        tree.push({ path, mode: FILE_MODE, type: 'blob', sha: blob.data.sha });
      }

      return finalizePr({ client, owner, repo, base, branch, baseSha, baseTreeSha, tree, title, body });
    },

    async openPatchPr({ files, branch, title, body }): Promise<PinnedPrResult> {
      assertWritableBranch(branch, github);
      if (files.length === 0) {
        throw new SafetyViolationError('patch PR requires at least one file');
      }
      const baseRef = await client.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
      const baseSha = baseRef.data.object.sha;
      const baseCommit = await client.rest.repos.getCommit({ owner, repo, ref: baseSha });
      const baseTreeSha = baseCommit.data.commit.tree.sha;

      const tree: {
        path: string;
        mode: string;
        type: string;
        sha?: string | null;
        content?: string;
      }[] = [];
      for (const f of files) {
        const blob = await client.rest.git.createBlob({
          owner,
          repo,
          content: Buffer.from(f.content, 'utf8').toString('base64'),
          encoding: 'base64',
        });
        tree.push({ path: f.path, mode: FILE_MODE, type: 'blob', sha: blob.data.sha });
      }

      return finalizePr({ client, owner, repo, base, branch, baseSha, baseTreeSha, tree, title, body });
    },
  };
}

/**
 * Shared create-only tail for both PR kinds: createTree → createCommit →
 * createRef (NEW branch) → pulls.create. There is deliberately **no** updateRef
 * on base, deleteRef, force flag, or merge here — the branch is *created* at the
 * new commit sha, never moved on top of a protected ref.
 */
async function finalizePr(args: {
  client: GitHubClient;
  owner: string;
  repo: string;
  base: string;
  branch: string;
  baseSha: string;
  baseTreeSha: string;
  tree: {
    path: string;
    mode: string;
    type: string;
    sha?: string | null;
    content?: string;
  }[];
  title: string;
  body: string;
}): Promise<PinnedPrResult> {
  const { client, owner, repo, base, branch, baseSha, baseTreeSha, tree, title, body } = args;

  const newTree = await client.rest.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree,
  });
  const commit = await client.rest.git.createCommit({
    owner,
    repo,
    message: title,
    tree: newTree.data.sha,
    parents: [baseSha],
  });
  // Create the branch pointing straight at the new commit (pure create — no
  // updateRef needed, so base can never be moved).
  await client.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: commit.data.sha,
  });
  const pr = await client.rest.pulls.create({
    owner,
    repo,
    title,
    head: branch,
    base,
    body,
  });
  return {
    number: pr.data.number,
    id: pr.data.id,
    url: pr.data.html_url,
    branch,
    base,
    head_sha: pr.data.head.sha,
  };
}

/** Best-effort 404 detection across Octokit's error shapes. */
function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const status = (err as { status?: number }).status;
  return status === 404;
}
