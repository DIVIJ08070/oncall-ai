import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Config } from '../../config.js';
import type { Daos } from '../../db/dao/index.js';
import { buildLearnedContext } from '../learning/context.js';
import { ghFetch, parseRepoUrl, upstreamStatusError } from './github.js';
import { reviewDiff } from './gemini.js';
import {
  CodeReviewError,
  type AutoReview,
  type CustomRule,
  type WatchedRepo,
} from './types.js';

/**
 * Code Review Buddy — PR Watch. A user registers a repo; a 60 s poller then
 * lists its open PRs, auto-reviews each unseen `(prNumber, headSha)` with the
 * existing Gemini diff reviewer, best-effort posts the review as a PR comment
 * (marker-deduped; needs a GITHUB_TOKEN with access), and always records an
 * `AutoReview` for the dashboard.
 *
 * Persistence is a JSON file next to the sqlite database
 * (`data/code-review-watch.json`), written temp-then-rename after every
 * change. Missing/corrupt files start empty. Every GitHub/Gemini failure
 * inside the poller is caught + logged (`[pr-watch]`) — the loop never
 * crashes the server.
 */

const STORE_FILENAME = 'code-review-watch.json';
/** Stored review cap (the GET route serves at most 50 of these). */
const MAX_REVIEWS_STORED = 100;
/** Gemini free tier: at most this many PR reviews per cycle, sequentially. */
const MAX_REVIEWS_PER_CYCLE = 3;
const MAX_DIFF_CHARS = 90000;
const OPEN_PRS_PER_REPO = 10;
/** Hidden dedupe marker embedded in every posted comment. */
const COMMENT_MARKER_PREFIX = '<!-- code-review-buddy:';

interface WatchState {
  watches: WatchedRepo[];
  reviews: AutoReview[];
}

interface Store {
  file: string;
  state: WatchState;
}

let store: Store | null = null;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ── persistence ────────────────────────────────────────────────────────── */

/** Same dir the sqlite file lives in (DATABASE_URL), `./data` for `:memory:`. */
function dataDirFor(config: Config): string {
  const raw = config.server.databaseUrl;
  const p = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
  if (p === ':memory:') return path.resolve('./data');
  return path.dirname(path.resolve(p));
}

function loadStore(config: Config): Store {
  if (store) return store;
  const file = path.join(dataDirFor(config), STORE_FILENAME);
  let state: WatchState = { watches: [], reviews: [] };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (typeof raw === 'object' && raw !== null) {
      const r = raw as { watches?: unknown; reviews?: unknown };
      state = {
        watches: Array.isArray(r.watches) ? (r.watches as WatchedRepo[]) : [],
        reviews: Array.isArray(r.reviews) ? (r.reviews as AutoReview[]) : [],
      };
      // Newest-first invariant + stored cap, defensively re-applied on load.
      state.reviews.sort((a, b) => b.reviewedAt - a.reviewedAt);
      if (state.reviews.length > MAX_REVIEWS_STORED) {
        state.reviews.length = MAX_REVIEWS_STORED;
      }
    }
  } catch {
    // missing or corrupt file → start empty
  }
  store = { file, state };
  return store;
}

/** Atomic-ish write: temp file + rename. Failures are logged, never thrown. */
function persist(s: Store): void {
  try {
    mkdirSync(path.dirname(s.file), { recursive: true });
    const tmp = `${s.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(s.state, null, 2));
    renameSync(tmp, s.file);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[pr-watch] failed to persist watch store — ${errMsg(err)}`);
  }
}

/* ── route-facing API ───────────────────────────────────────────────────── */

/** Full store state (routes cap `reviews` to 50 on the wire themselves). */
export function listState(config: Config): WatchState {
  const s = loadStore(config);
  return { watches: [...s.state.watches], reviews: [...s.state.reviews] };
}

/**
 * Register a repo for PR Watch. Throws `CodeReviewError`: 400 on a bad URL,
 * 409 (validation_error) when already watched, 404 when the repo does not
 * exist / is not visible, 429/502 on GitHub trouble.
 */
export async function addWatch(
  config: Config,
  repoUrl: string,
  rules?: CustomRule[],
): Promise<WatchedRepo> {
  const ref = parseRepoUrl(repoUrl);
  if (!ref) {
    throw new CodeReviewError(
      400,
      'validation_error',
      'repoUrl must be a GitHub repository URL like https://github.com/owner/repo',
    );
  }
  const s = loadStore(config);
  const dup = s.state.watches.some(
    (w) =>
      w.owner.toLowerCase() === ref.owner.toLowerCase() &&
      w.repo.toLowerCase() === ref.repo.toLowerCase(),
  );
  if (dup) {
    throw new CodeReviewError(
      409,
      'validation_error',
      `${ref.owner}/${ref.repo} is already being watched`,
    );
  }

  // Verify the repo exists before accepting the watch.
  const res = await ghFetch(config, `/repos/${ref.owner}/${ref.repo}`);
  if (res.status === 404) {
    throw new CodeReviewError(404, 'not_found', 'Repository not found or not public');
  }
  if (!res.ok) throw upstreamStatusError(res.status, 'verifying the repository');

  const watch: WatchedRepo = {
    id: `watch_${randomUUID()}`,
    repoUrl: repoUrl.trim(),
    owner: ref.owner,
    repo: ref.repo,
    createdAt: Date.now(),
    rules: rules ?? [],
  };
  s.state.watches.push(watch);
  persist(s);
  return watch;
}

/** Remove a watch by id. Returns false when the id is unknown (route → 404). */
export function removeWatch(config: Config, id: string): boolean {
  const s = loadStore(config);
  const before = s.state.watches.length;
  s.state.watches = s.state.watches.filter((w) => w.id !== id);
  if (s.state.watches.length === before) return false;
  persist(s);
  return true;
}

/* ── poller ─────────────────────────────────────────────────────────────── */

interface OpenPr {
  number: number;
  title: string;
  url: string;
  headSha: string;
}

async function fetchOpenPrs(config: Config, watch: WatchedRepo): Promise<OpenPr[]> {
  const res = await ghFetch(
    config,
    `/repos/${watch.owner}/${watch.repo}/pulls?state=open&per_page=${OPEN_PRS_PER_REPO}`,
  );
  if (!res.ok) throw upstreamStatusError(res.status, 'listing open pull requests');
  const body = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) return [];
  const out: OpenPr[] = [];
  for (const item of body) {
    const p = item as {
      number?: unknown;
      title?: unknown;
      html_url?: unknown;
      head?: { sha?: unknown };
    };
    if (typeof p.number !== 'number' || typeof p.head?.sha !== 'string') continue;
    out.push({
      number: p.number,
      title: typeof p.title === 'string' ? p.title : `PR #${p.number}`,
      url:
        typeof p.html_url === 'string'
          ? p.html_url
          : `https://github.com/${watch.owner}/${watch.repo}/pull/${p.number}`,
      headSha: p.head.sha,
    });
  }
  return out;
}

/**
 * Best-effort PR comment. Returns true when we posted the comment or found an
 * existing one carrying this head-sha marker; false when no token is set or
 * GitHub rejects the write (401/403/404, …). Never throws.
 */
async function tryPostComment(
  config: Config,
  watch: WatchedRepo,
  pr: OpenPr,
  markdownComment: string,
): Promise<boolean> {
  if (!config.github.token) return false;
  const marker = `${COMMENT_MARKER_PREFIX}${pr.headSha} -->`;
  try {
    // Dedupe: scan ~30 issue comments for the marker before posting.
    const listRes = await ghFetch(
      config,
      `/repos/${watch.owner}/${watch.repo}/issues/${pr.number}/comments?per_page=30`,
    );
    if (listRes.ok) {
      const comments = (await listRes.json().catch(() => null)) as unknown;
      if (
        Array.isArray(comments) &&
        comments.some((c) => {
          const body = (c as { body?: unknown }).body;
          return typeof body === 'string' && body.includes(marker);
        })
      ) {
        return true;
      }
    }
    const body =
      `${markdownComment}\n\n---\n` +
      `_Automated review by Code Review Buddy (PR Watch)._\n${marker}`;
    const postRes = await ghFetch(
      config,
      `/repos/${watch.owner}/${watch.repo}/issues/${pr.number}/comments`,
      'application/vnd.github+json',
      { method: 'POST', body: JSON.stringify({ body }) },
    );
    if (postRes.ok) return true;
    // eslint-disable-next-line no-console
    console.warn(
      `[pr-watch] comment on ${watch.owner}/${watch.repo}#${pr.number} rejected (HTTP ${postRes.status})`,
    );
    return false;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[pr-watch] comment on ${watch.owner}/${watch.repo}#${pr.number} failed — ${errMsg(err)}`,
    );
    return false;
  }
}

/** Truncation guard for learning fields derived from model output. */
const MAX_LEARNING_CHARS = 300;

function clipLearning(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > MAX_LEARNING_CHARS ? `${t.slice(0, MAX_LEARNING_CHARS - 1)}…` : t;
}

/**
 * Self-learning auto-signal: one learning per HIGH/CRITICAL finding of a
 * completed review (source "review", rating +1, dedup-confirmed via
 * `confirmOrCreate`). Strictly best-effort — any failure is logged and
 * swallowed so the watch cycle never breaks.
 */
function recordReviewLearnings(daos: Daos, review: AutoReview): void {
  try {
    const repo = `${review.owner}/${review.repo}`;
    for (const category of review.categories) {
      if (category.severity !== 'high' && category.severity !== 'critical') continue;
      const findings =
        category.findings.length > 0 ? category.findings : [category.summary];
      for (const finding of findings) {
        if (typeof finding !== 'string' || finding.trim() === '') continue;
        daos.repoLearnings.confirmOrCreate({
          repo,
          error_class: category.name,
          root_cause: clipLearning(finding),
          source: 'review',
          rating: 1,
          pr_number: review.prNumber,
        });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[pr-watch] recording review learnings failed — ${errMsg(err)}`);
  }
}

async function reviewOnePr(
  config: Config,
  watch: WatchedRepo,
  pr: OpenPr,
  daos?: Daos,
): Promise<AutoReview> {
  const diffRes = await ghFetch(
    config,
    `/repos/${watch.owner}/${watch.repo}/pulls/${pr.number}`,
    'application/vnd.github.diff',
  );
  if (!diffRes.ok) {
    throw upstreamStatusError(diffRes.status, `fetching the diff for PR #${pr.number}`);
  }
  const diff = (await diffRes.text()).slice(0, MAX_DIFF_CHARS);
  if (diff.trim() === '') {
    throw new CodeReviewError(502, 'upstream_error', 'GitHub returned an empty diff');
  }

  // Self-learning: inject this repo's learned context into the review prompt
  // (buildLearnedContext never throws; '' when the repo has no learnings yet).
  const learnedContext = daos
    ? buildLearnedContext(daos, `${watch.owner}/${watch.repo}`)
    : '';

  // Existing Gemini diff reviewer; the prompt layer keeps only enabled rules.
  const result = await reviewDiff(config, {
    diff,
    prTitle: pr.title,
    ...(watch.rules.length > 0 ? { customRules: watch.rules } : {}),
    ...(learnedContext !== '' ? { learnedContext } : {}),
  });

  const commented = await tryPostComment(config, watch, pr, result.markdownComment);

  return {
    id: `arev_${randomUUID()}`,
    ...(result.engine ? { engine: result.engine } : {}),
    watchId: watch.id,
    owner: watch.owner,
    repo: watch.repo,
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.url,
    headSha: pr.headSha,
    overallScore: result.overallScore,
    categories: result.categories,
    markdownComment: result.markdownComment,
    commented,
    reviewedAt: Date.now(),
  };
}

async function runWatchCycle(config: Config, daos?: Daos): Promise<void> {
  const s = loadStore(config);
  if (s.state.watches.length === 0) return;
  if (!config.codeReview.geminiApiKey) {
    // eslint-disable-next-line no-console
    console.warn('[pr-watch] GEMINI_API_KEY is empty — skipping auto-review cycle');
    return;
  }

  // Sequential reviews (Gemini free tier), ≤3 per cycle across all watches.
  let budget = MAX_REVIEWS_PER_CYCLE;
  for (const watch of [...s.state.watches]) {
    if (budget <= 0) break;
    let prs: OpenPr[];
    try {
      prs = await fetchOpenPrs(config, watch);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pr-watch] could not list PRs for ${watch.owner}/${watch.repo} — ${errMsg(err)}`,
      );
      continue;
    }
    for (const pr of prs) {
      if (budget <= 0) break;
      const seen = s.state.reviews.some(
        (r) =>
          r.owner === watch.owner &&
          r.repo === watch.repo &&
          r.prNumber === pr.number &&
          r.headSha === pr.headSha,
      );
      if (seen) continue;
      budget--;
      try {
        const review = await reviewOnePr(config, watch, pr, daos);
        s.state.reviews.unshift(review);
        if (s.state.reviews.length > MAX_REVIEWS_STORED) {
          s.state.reviews.length = MAX_REVIEWS_STORED;
        }
        persist(s);
        // Self-learning auto-signal (guarded inside; never breaks the cycle).
        if (daos) recordReviewLearnings(daos, review);
        // eslint-disable-next-line no-console
        console.log(
          `[pr-watch] reviewed ${watch.owner}/${watch.repo}#${pr.number} @ ${pr.headSha.slice(0, 7)} ` +
            `(score ${review.overallScore}, commented=${String(review.commented)})`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[pr-watch] review failed for ${watch.owner}/${watch.repo}#${pr.number} — ${errMsg(err)}`,
        );
      }
    }
  }
}

export interface CodeReviewWatcher {
  stop(): void;
  /** One guarded cycle (exposed for tests / manual triggering). */
  runCycle(): Promise<void>;
}

/** Optional wiring for the watcher (self-learning needs the DAO set). */
export interface CodeReviewWatcherDeps {
  /** When present: learned context is injected into review prompts and
   *  HIGH/CRITICAL findings are recorded as per-repo learnings. */
  daos?: Daos;
}

/**
 * Start the PR-Watch poller: an immediate first cycle, then every
 * `CODE_REVIEW_WATCH_INTERVAL_MS` (default 60 s). Overlapping runs are
 * skipped; the timer is `unref()`'d like the other background loops.
 */
export function startCodeReviewWatcher(
  config: Config,
  deps: CodeReviewWatcherDeps = {},
): CodeReviewWatcher {
  let running = false;
  const cycle = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runWatchCycle(config, deps.daos);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[pr-watch] cycle failed — ${errMsg(err)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void cycle();
  }, config.codeReview.watchIntervalMs);
  timer.unref();
  void cycle();
  return {
    stop: () => clearInterval(timer),
    runCycle: cycle,
  };
}
