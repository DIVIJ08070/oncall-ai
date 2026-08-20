import type { Config } from '../../config.js';
import { CodeReviewError } from './types.js';

/**
 * Code Review Buddy — GitHub reader for public-repo scans. A fresh plain-fetch
 * client against api.github.com on purpose: the existing Octokit gateway is
 * deliberately safety-pinned to the demo victim repo and must not be reused
 * here. `GITHUB_TOKEN` (when set) only raises rate limits; unauthenticated
 * works too for public repos.
 */

const API_BASE = 'https://api.github.com';

const INCLUDE_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.go', '.rb', '.php', '.css',
];
const EXCLUDE_PATH_PARTS = [
  'node_modules/', 'dist/', 'build/', '.git/', 'vendor/', 'coverage/',
];
const LOCK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'gemfile.lock', 'go.sum',
]);

const MAX_FILES = 15;
const MAX_BLOB_BYTES = 50 * 1024;
const MAX_CONTENT_CHARS = 15000;
const FETCH_CONCURRENCY = 3;

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepoFile {
  path: string;
  content: string;
}

/** `https://github.com/owner/repo(.git)(/anything)` → { owner, repo } | null. */
export function parseRepoUrl(url: string): RepoRef | null {
  const m = url
    .trim()
    .match(
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#].*)?$/,
    );
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  // Reject '.'/'..' segments: they would collapse the api.github.com path
  // (e.g. /repos/../user → /user) and send the server's token to an
  // attacker-chosen endpoint. Require at least one alphanumeric character.
  if (!/[A-Za-z0-9]/.test(owner) || !/[A-Za-z0-9]/.test(repo)) return null;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

function ghHeaders(config: Config, accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept,
    'user-agent': 'oncall-ai-code-review-buddy',
    'x-github-api-version': '2022-11-28',
  };
  if (config.github.token) {
    headers.authorization = `Bearer ${config.github.token}`;
  }
  return headers;
}

async function ghFetch(
  config: Config,
  path: string,
  accept = 'application/vnd.github+json',
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    headers: ghHeaders(config, accept),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new CodeReviewError(
      502,
      'upstream_error',
      'Could not reach the GitHub API in time — check the server network connection and try again.',
    );
  });
}

function upstreamStatusError(status: number, what: string): CodeReviewError {
  // 403/429 from GitHub is almost always rate limiting (60 req/hr unauthenticated;
  // one scan can spend ~17), so name it plainly instead of a generic upstream error.
  if (status === 403 || status === 429) {
    return new CodeReviewError(
      429,
      'rate_limited',
      'GitHub API rate limit reached while ' +
        what +
        '. Set GITHUB_TOKEN in the server .env (free — raises the limit from 60 to 5,000 requests/hour) and retry.',
    );
  }
  return new CodeReviewError(
    502,
    'upstream_error',
    `The GitHub API returned HTTP ${status} while ${what} — try again in a moment.`,
  );
}

/* ── file selection ─────────────────────────────────────────────────────── */

function isReviewablePath(path: string): boolean {
  const lower = path.toLowerCase();
  if (EXCLUDE_PATH_PARTS.some((part) => lower.includes(part))) return false;
  const base = lower.split('/').pop() ?? lower;
  if (LOCK_FILES.has(base)) return false;
  if (base.includes('.min.')) return false;
  if (lower.endsWith('.d.ts')) return false;
  return INCLUDE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function pathDepth(path: string): number {
  return path.split('/').length;
}

interface TreeEntry {
  path?: unknown;
  type?: unknown;
  size?: unknown;
}

/** Blobs only, include/exclude filters, ≤50KB, capped at 15 shallowest paths. */
function selectPaths(tree: TreeEntry[]): string[] {
  return tree
    .filter(
      (e): e is TreeEntry & { path: string } =>
        e.type === 'blob' &&
        typeof e.path === 'string' &&
        (typeof e.size !== 'number' || e.size <= MAX_BLOB_BYTES) &&
        isReviewablePath(e.path),
    )
    .map((e) => e.path)
    .sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b))
    .slice(0, MAX_FILES);
}

/* ── GitHub reads ───────────────────────────────────────────────────────── */

async function fetchDefaultBranch(config: Config, ref: RepoRef): Promise<string> {
  const res = await ghFetch(config, `/repos/${ref.owner}/${ref.repo}`);
  if (res.status === 404) {
    throw new CodeReviewError(404, 'not_found', 'Repository not found or not public');
  }
  if (!res.ok) throw upstreamStatusError(res.status, 'reading the repository');
  const body = (await res.json().catch(() => null)) as {
    default_branch?: unknown;
  } | null;
  return typeof body?.default_branch === 'string' ? body.default_branch : 'main';
}

async function fetchTree(
  config: Config,
  ref: RepoRef,
  branch: string,
): Promise<TreeEntry[]> {
  const res = await ghFetch(
    config,
    `/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  if (!res.ok) throw upstreamStatusError(res.status, 'listing the repository tree');
  const body = (await res.json().catch(() => null)) as { tree?: unknown; truncated?: boolean } | null;
  // #5: on very large repos GitHub caps the recursive tree and sets truncated:true.
  // We only scan the first 15 files anyway, but log it so a partial scan isn't silent.
  if (body?.truncated) {
    // eslint-disable-next-line no-console
    console.warn('[code-review] GitHub tree was truncated for %s/%s — scanning a subset.', ref.owner, ref.repo);
  }
  return Array.isArray(body?.tree) ? (body.tree as TreeEntry[]) : [];
}

async function fetchFileContent(
  config: Config,
  ref: RepoRef,
  branch: string,
  path: string,
): Promise<string> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const res = await ghFetch(
    config,
    `/repos/${ref.owner}/${ref.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    'application/vnd.github.raw',
  );
  if (!res.ok) throw upstreamStatusError(res.status, `fetching ${path}`);
  const text = await res.text();
  return text.slice(0, MAX_CONTENT_CHARS);
}

/**
 * Resolve the default branch, walk the tree, and return up to 15 reviewable
 * files with their (truncated) contents. Individual content-fetch failures are
 * logged and skipped; an empty selection is a 422 the caller surfaces as-is.
 */
export async function collectRepoFiles(
  config: Config,
  ref: RepoRef,
): Promise<RepoFile[]> {
  const branch = await fetchDefaultBranch(config, ref);
  const tree = await fetchTree(config, ref, branch);
  const paths = selectPaths(tree);
  if (paths.length === 0) {
    throw new CodeReviewError(422, 'validation_error', 'No reviewable source files found');
  }

  // Bounded-concurrency content fetch; results keep the selected path order.
  const slots: (RepoFile | null)[] = new Array<RepoFile | null>(paths.length).fill(null);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < paths.length) {
      const index = cursor++;
      const path = paths[index];
      try {
        slots[index] = { path, content: await fetchFileContent(config, ref, branch, path) };
      } catch (err) {
        console.log(
          `[code-review] skipped ${ref.owner}/${ref.repo}:${path} — ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, paths.length) }, () => worker()),
  );

  const files = slots.filter((f): f is RepoFile => f !== null);
  if (files.length === 0) {
    throw new CodeReviewError(
      502,
      'upstream_error',
      'Could not fetch any file contents from GitHub — try again.',
    );
  }
  return files;
}
