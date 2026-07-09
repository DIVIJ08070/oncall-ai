/**
 * scripts/init-victim-repo.ts — seed the standalone customer repo (SPEC §11, §12).
 *
 * Using Octokit + `GITHUB_TOKEN`/`GITHUB_OWNER`/`GITHUB_REPO` from `.env`, this:
 *   1. Creates `OWNER/REPO` (`DIVIJ08070/oncall-ai-victim`) if it does not exist.
 *   2. Pushes a **baseline healthy** root commit (a self-contained Express app —
 *      no `@oncall/*` deps; telemetry vendored) with `ci.yml` + `deploy.yml`.
 *   3. Pushes **one bad-deploy commit per failure mode** onto `main`, each a clean,
 *      revertable single-file diff:
 *        - `bad_deploy`   → removes the null guard in `src/routes/checkout.ts`
 *        - `slow_db`      → swaps the fast query for a slow scan in `src/routes/reports.ts`
 *        - `config_error` → removes the `PRICING_TABLE` default in `src/config.ts`
 *   4. Records the SHA↔mode manifest (`data/victim-manifest.json`) and `deploys`
 *      rows in the platform DB so `get_recent_deploys` / `get_deploy_diff` return
 *      real data and `POST /demo/failure-mode` can mark the right SHA current.
 *
 * SAFETY: if the PAT cannot CREATE the repo (403 on `POST /user/repos`), the script
 * does NOT fabricate anything — it exits with a clear BLOCKED message so a human can
 * create an empty `OWNER/REPO`, after which re-running seeds with the same token.
 *
 * Before running, build the workspace (`npm run build`) so the compiled DB layer
 * is importable. Run: `npx tsx scripts/init-victim-repo.ts`.
 */

import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Octokit } from '@octokit/rest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const VICTIM_DIR = join(REPO_ROOT, 'apps/victim');

/* ── env ─────────────────────────────────────────────────────────────────── */

const TOKEN = process.env.GITHUB_TOKEN?.trim();
const OWNER = (process.env.GITHUB_OWNER ?? 'DIVIJ08070').trim();
const REPO = (process.env.GITHUB_REPO ?? 'oncall-ai-victim').trim();
const DEFAULT_BRANCH = (process.env.GITHUB_DEFAULT_BRANCH ?? 'main').trim();
const INGEST_API_KEY = (process.env.INGEST_API_KEY ?? 'dev-local-ingest-key').trim();
const DATABASE_URL = (process.env.DATABASE_URL ?? './data/oncall.sqlite').trim();
const SKIP_LOCAL_VERIFY = /^(1|true|yes)$/i.test(process.env.SKIP_LOCAL_VERIFY ?? '');

if (!TOKEN) {
  console.error('[init-victim-repo] GITHUB_TOKEN is not set in .env — cannot proceed.');
  process.exit(1);
}

const octokit = new Octokit({ auth: TOKEN });

/* ── file contents ────────────────────────────────────────────────────────── */

/** Read a file authored in `apps/victim` for verbatim reuse in the mirror. */
function fromVictim(rel: string): string {
  return readFileSync(join(VICTIM_DIR, rel), 'utf8');
}

const MIRROR_SERVER_TS = `import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { config } from './config.js';
import { oncall } from './telemetry.js';
import { checkoutRouter } from './routes/checkout.js';
import { reportsRouter } from './routes/reports.js';
import { pricingRouter } from './routes/pricing.js';

/** Assemble the Express app (exported for tests). */
export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  const telemetry = oncall({
    apiKey: config.apiKey,
    service: config.service,
    ingestUrl: config.ingestUrl,
  });
  app.use(telemetry);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: config.service });
  });

  app.use('/api/checkout', checkoutRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/pricing', pricingRouter);

  app.use(telemetry.errorHandler);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    if (res.headersSent) return;
    res.status(500).json({ error: { code: 'internal', message } });
  });

  return app;
}

function isMain(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('server.ts') || entry.endsWith('server.js');
}

if (isMain()) {
  createApp().listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(\`[victim] \${config.service} listening on :\${config.port}\`);
  });
}
`;

const MIRROR_CONFIG_BASELINE = `/** App config. \`PRICING_TABLE\` has a safe default in the healthy build. */
function num(name: string, def: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : def;
}
function str(name: string, def: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? def : raw;
}

export const config = {
  port: num('PORT', num('VICTIM_PORT', 4000)),
  service: str('SERVICE_NAME', str('VICTIM_SERVICE', 'checkout-api')),
  ingestUrl: str('ONCALL_INGEST_URL', 'http://localhost:3001/api/v1/ingest'),
  apiKey: str('ONCALL_API_KEY', 'dev-local-ingest-key'),
  // Pricing table config default (present in the healthy build).
  pricingTable: process.env.PRICING_TABLE ?? 'default-pricing-v1',
};
`;

// config_error bad deploy: the default is removed → undefined when the env is unset.
const MIRROR_CONFIG_BAD = MIRROR_CONFIG_BASELINE.replace(
  `  pricingTable: process.env.PRICING_TABLE ?? 'default-pricing-v1',`,
  `  pricingTable: process.env.PRICING_TABLE,`,
);

const MIRROR_CHECKOUT_BASELINE = `import { Router, type Request } from 'express';

export const checkoutRouter = Router();

interface Cart {
  items: Array<{ sku: string; qty: number; price: number }>;
}

/** The cart attached to the caller's session (absent for anonymous traffic). */
function getSessionCart(req: Request): Cart {
  return (req as unknown as { session?: { cart?: Cart } }).session?.cart as Cart;
}

checkoutRouter.post('/', (req, res) => {
  const bodyItems = ((req.body ?? {}) as { cart?: Cart }).cart?.items;
  // Null guard: tolerate a missing session cart, fall back to the request body.
  const items = getSessionCart(req)?.items ?? bodyItems ?? [];

  const total = items.reduce((sum, it) => sum + it.qty * it.price, 0);
  res.status(200).json({
    ok: true,
    order_id: \`ord_\${Date.now().toString(36)}\`,
    item_count: items.length,
    total_cents: Math.round(total * 100),
  });
});
`;

// bad_deploy: the null guard (\`?.\`) is removed → undefined session cart throws.
const MIRROR_CHECKOUT_BAD = MIRROR_CHECKOUT_BASELINE.replace(
  `  const items = getSessionCart(req)?.items ?? bodyItems ?? [];`,
  `  const items = getSessionCart(req).items ?? bodyItems ?? [];`,
);

const MIRROR_REPORTS_BASELINE = `import { Router } from 'express';

export const reportsRouter = Router();

/** Fast, indexed report query. */
function reportQuery(): { rows: number; window: string } {
  return { rows: 128, window: 'last_24h' };
}

reportsRouter.get('/', (_req, res) => {
  const result = reportQuery();
  res.status(200).json({ ok: true, report: result, generated_at: Date.now() });
});
`;

// slow_db: the indexed query is swapped for a slow full-scan path (2–4s).
const MIRROR_REPORTS_BAD = `import { Router } from 'express';

export const reportsRouter = Router();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Slow full-table-scan report query (missing index) — 2–4s. */
async function reportQuery(): Promise<{ rows: number; window: string }> {
  await sleep(2200 + Math.floor(Math.random() * 1600));
  return { rows: 128, window: 'last_24h' };
}

reportsRouter.get('/', async (_req, res) => {
  const result = await reportQuery();
  res.status(200).json({ ok: true, report: result, generated_at: Date.now() });
});
`;

const MIRROR_PRICING = `import { Router } from 'express';
import { config } from '../config.js';

export const pricingRouter = Router();

pricingRouter.get('/', (_req, res) => {
  const pricingTable = config.pricingTable;
  if (!pricingTable) {
    // The pricing table config is missing (removed default + unset env).
    throw new Error('Missing config PRICING_TABLE');
  }
  res.status(200).json({
    ok: true,
    table: pricingTable,
    plans: [
      { id: 'basic', price_cents: 900 },
      { id: 'pro', price_cents: 2900 },
      { id: 'scale', price_cents: 9900 },
    ],
  });
});
`;

const MIRROR_TEST = `import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';

// Liveness smoke test — passes at every commit regardless of which failure the
// deployed code carries (the failures live on the business routes, not /health).
describe('victim', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((r) => {
      server = app.listen(0, () => r());
    });
    const { port } = server.address() as AddressInfo;
    base = \`http://127.0.0.1:\${port}\`;
  });

  afterAll(() => server?.close());

  it('serves /health', async () => {
    const res = await fetch(\`\${base}/health\`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });
});
`;

/** The full baseline (healthy) mirror tree, path → content. */
function baselineTree(packageLock: string): Record<string, string> {
  return {
    'package.json': fromVictim('package.json'),
    'package-lock.json': packageLock,
    'tsconfig.json': fromVictim('tsconfig.json'),
    '.gitignore': fromVictim('.gitignore'),
    'README.md': fromVictim('README.md'),
    '.github/workflows/ci.yml': fromVictim('.github/workflows/ci.yml'),
    '.github/workflows/deploy.yml': fromVictim('.github/workflows/deploy.yml'),
    'src/telemetry.ts': fromVictim('src/telemetry.ts'),
    'src/server.ts': MIRROR_SERVER_TS,
    'src/config.ts': MIRROR_CONFIG_BASELINE,
    'src/routes/checkout.ts': MIRROR_CHECKOUT_BASELINE,
    'src/routes/reports.ts': MIRROR_REPORTS_BASELINE,
    'src/routes/pricing.ts': MIRROR_PRICING,
    'test/smoke.test.ts': MIRROR_TEST,
  };
}

type Mode = 'bad_deploy' | 'slow_db' | 'config_error';

/** The single-file change each bad-deploy commit introduces. */
const BAD_COMMITS: Array<{
  mode: Mode;
  message: string;
  path: string;
  content: string;
}> = [
  {
    mode: 'bad_deploy',
    message: 'checkout: drop redundant session-cart null check\n\nThe `?.` guard on the session cart looked unnecessary — removing it.',
    path: 'src/routes/checkout.ts',
    content: MIRROR_CHECKOUT_BAD,
  },
  {
    mode: 'slow_db',
    message: 'reports: switch to full report scan for accuracy\n\nReplace the cached/indexed lookup with a direct scan.',
    path: 'src/routes/reports.ts',
    content: MIRROR_REPORTS_BAD,
  },
  {
    mode: 'config_error',
    message: 'config: source PRICING_TABLE from env only\n\nDrop the hardcoded pricing-table default; expect it from the environment.',
    path: 'src/config.ts',
    content: MIRROR_CONFIG_BAD,
  },
];

/* ── package-lock generation + local Actions-parity verify ───────────────── */

function generateLockAndVerify(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'oncall-victim-'));
  const baseline = baselineTree(''); // lockfile filled after install
  for (const [rel, content] of Object.entries(baseline)) {
    if (rel === 'package-lock.json') continue;
    const abs = join(tmp, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const run = (args: string[]): void => {
    execFileSync('npm', args, { cwd: tmp, stdio: 'inherit' });
  };
  console.log(`[init-victim-repo] verifying standalone build in ${tmp} …`);
  run(['install', '--no-audit', '--no-fund']);
  if (!SKIP_LOCAL_VERIFY) {
    run(['run', 'build']);
    run(['test']);
    // Also verify the HEAD state (all three bad deploys applied) is Actions-green.
    for (const bc of BAD_COMMITS) {
      const abs = join(tmp, bc.path);
      writeFileSync(abs, bc.content);
    }
    console.log('[init-victim-repo] verifying HEAD (all bad deploys) build + test …');
    run(['run', 'build']);
    run(['test']);
  }
  return readFileSync(join(tmp, 'package-lock.json'), 'utf8');
}

/* ── Octokit git plumbing ────────────────────────────────────────────────── */

async function repoExists(): Promise<boolean> {
  try {
    await octokit.repos.get({ owner: OWNER, repo: REPO });
    return true;
  } catch (err) {
    if ((err as { status?: number }).status === 404) return false;
    throw err;
  }
}

async function createRepo(): Promise<void> {
  try {
    await octokit.repos.createForAuthenticatedUser({
      name: REPO,
      description: 'OnCall AI demo victim — switchable failure modes for AI incident response.',
      private: false,
      auto_init: false,
      has_issues: true,
    });
    console.log(`[init-victim-repo] created ${OWNER}/${REPO}`);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 403 || status === 404) {
      console.error('\n==================== C4 BLOCKED ====================');
      console.error(
        `The GitHub PAT cannot CREATE a repository (HTTP ${status} on POST /user/repos).`,
      );
      console.error(
        `A human must create an EMPTY public repo:  https://github.com/new  →  ${OWNER}/${REPO}`,
      );
      console.error(
        '(No README/gitignore/license — leave it empty.) Then re-run this script; the',
      );
      console.error('existing token can push the seed commits without repo-creation rights.');
      console.error('===================================================\n');
      process.exit(2);
    }
    throw err;
  }
}

interface CommitResult {
  commitSha: string;
  treeSha: string;
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

async function commitTree(
  message: string,
  files: Record<string, string>,
  parentCommitSha: string | null,
  baseTreeSha: string | null,
  authorDate: string,
): Promise<CommitResult> {
  const entries: Array<{
    path: string;
    mode: '100644';
    type: 'blob';
    sha: string;
  }> = [];
  for (const [path, content] of Object.entries(files)) {
    // Right after a repo's first commit, the Git Data API can briefly still 409
    // ("Git Repository is empty") — retry a few times with backoff.
    let blob;
    for (let attempt = 0; ; attempt++) {
      try {
        blob = await octokit.git.createBlob({
          owner: OWNER,
          repo: REPO,
          content: b64(content),
          encoding: 'base64',
        });
        break;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 409 && attempt < 6) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw err;
      }
    }
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.data.sha });
  }
  const tree = await octokit.git.createTree({
    owner: OWNER,
    repo: REPO,
    tree: entries,
    ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
  });
  const author = { name: 'Victim Dev Team', email: 'dev@oncall-victim.example', date: authorDate };
  const commit = await octokit.git.createCommit({
    owner: OWNER,
    repo: REPO,
    message,
    tree: tree.data.sha,
    parents: parentCommitSha ? [parentCommitSha] : [],
    author,
    committer: author,
  });
  return { commitSha: commit.data.sha, treeSha: tree.data.sha };
}

/**
 * The Git Data API (blobs/trees/commits) refuses to operate on a repository with
 * **zero commits** ("Git Repository is empty", 409). Bootstrap the first commit via
 * the Contents API (which works on an empty repo and creates the default branch),
 * then the baseline commit stacks on it. Returns the parent SHA for baseline
 * (`null` when the repo already has history → baseline is a fresh root commit).
 */
async function ensureSeedable(): Promise<string | null> {
  try {
    await octokit.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${DEFAULT_BRANCH}` });
    return null; // non-empty repo → Git Data API works; baseline is a root commit
  } catch (err) {
    // 404 (no ref) or 409 ("Git Repository is empty") both mean: no commits yet.
    const status = (err as { status?: number }).status;
    if (status !== 404 && status !== 409) throw err;
  }
  const init = await octokit.repos.createOrUpdateFileContents({
    owner: OWNER,
    repo: REPO,
    path: '.oncall-seed',
    message: 'chore: initialize repository',
    content: b64('OnCall AI victim — seeded repository.\n'),
    branch: DEFAULT_BRANCH,
  });
  console.log(`[init-victim-repo] bootstrapped empty repo (init ${(init.data.commit.sha ?? '').slice(0, 7)})`);
  return init.data.commit.sha ?? null;
}

async function upsertMainRef(sha: string): Promise<void> {
  const ref = `heads/${DEFAULT_BRANCH}`;
  try {
    await octokit.git.getRef({ owner: OWNER, repo: REPO, ref });
    await octokit.git.updateRef({ owner: OWNER, repo: REPO, ref, sha, force: true });
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      await octokit.git.createRef({
        owner: OWNER,
        repo: REPO,
        ref: `refs/heads/${DEFAULT_BRANCH}`,
        sha,
      });
    } else {
      throw err;
    }
  }
}

interface ManifestEntry {
  sha: string;
  short_sha: string;
  message: string;
  committed_at: number;
}

/* ── platform DB: customer + deploys rows (SPEC §8, §11) ─────────────────── */

interface LooseDb {
  dao: {
    customers: {
      getByIngestKey(k: string): { id: string } | null;
      create(i: Record<string, unknown>): { id: string };
    };
    deploys: {
      upsert(i: Record<string, unknown>): unknown;
      markCurrent(customerId: string, sha: string): unknown;
    };
  };
  close(): void;
}

async function recordDeploys(
  baseline: ManifestEntry,
  modes: Record<Mode, ManifestEntry>,
): Promise<void> {
  let mod: { openDatabase: (url: string) => LooseDb };
  try {
    mod = (await import('../packages/server/dist/db/index.js')) as unknown as {
      openDatabase: (url: string) => LooseDb;
    };
  } catch (err) {
    console.warn(
      '[init-victim-repo] could not import built DB layer (run `npm run build` first). ' +
        'Skipping deploys rows; manifest still written. Error:',
      (err as Error).message,
    );
    return;
  }
  const db = mod.openDatabase(DATABASE_URL);
  try {
    const existing = db.dao.customers.getByIngestKey(INGEST_API_KEY);
    const customer =
      existing ??
      db.dao.customers.create({
        name: 'demo',
        ingest_api_key: INGEST_API_KEY,
        github_owner: OWNER,
        github_repo: REPO,
        default_branch: DEFAULT_BRANCH,
      });

    db.dao.deploys.upsert({
      customer_id: customer.id,
      sha: baseline.sha,
      short_sha: baseline.short_sha,
      ref: DEFAULT_BRANCH,
      message: baseline.message.split('\n')[0],
      author: 'Victim Dev Team',
      committed_at: baseline.committed_at,
      source: 'baseline',
      is_current: true, // healthy is the "current" deploy until a mode is flipped
    });
    for (const mode of ['bad_deploy', 'slow_db', 'config_error'] as Mode[]) {
      const m = modes[mode];
      db.dao.deploys.upsert({
        customer_id: customer.id,
        sha: m.sha,
        short_sha: m.short_sha,
        ref: DEFAULT_BRANCH,
        message: m.message.split('\n')[0],
        author: 'Victim Dev Team',
        committed_at: m.committed_at,
        source: 'bad_deploy',
        is_current: false,
      });
    }
    db.dao.deploys.markCurrent(customer.id, baseline.sha);
    console.log(
      `[init-victim-repo] recorded 4 deploys rows for customer ${customer.id} (baseline current).`,
    );
  } finally {
    db.close();
  }
}

/* ── main ────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  // DRY_RUN: verify the mirror builds + tests standalone (== what Actions does),
  // generate the lockfile, and exit WITHOUT touching GitHub or the DB.
  if (/^(1|true|yes)$/i.test(process.env.DRY_RUN ?? '')) {
    generateLockAndVerify();
    console.log('[init-victim-repo] DRY_RUN ok — mirror baseline + HEAD build & test green.');
    return;
  }

  const me = await octokit.users.getAuthenticated();
  console.log(`[init-victim-repo] authenticated as ${me.data.login} → target ${OWNER}/${REPO}`);

  const exists = await repoExists();
  if (!exists) {
    await createRepo();
  } else {
    console.log(`[init-victim-repo] ${OWNER}/${REPO} already exists — will (re)seed main.`);
  }

  const packageLock = generateLockAndVerify();

  // Space commits out in the recent past so ordering (oldest → newest) is clear.
  const now = Date.now();
  const at = (minsAgo: number): { ms: number; iso: string } => {
    const ms = now - minsAgo * 60_000;
    return { ms, iso: new Date(ms).toISOString() };
  };
  const short = (sha: string): string => sha.slice(0, 7);

  // 1) baseline healthy commit (bootstrap the repo first if it is empty)
  const baselineParent = await ensureSeedable();
  const baseAt = at(40);
  const baseline = await commitTree(
    'chore: bootstrap checkout-api service\n\nHealthy baseline: checkout, reports, pricing + telemetry + CI/deploy.',
    baselineTree(packageLock),
    baselineParent,
    null,
    baseAt.iso,
  );
  await upsertMainRef(baseline.commitSha);
  console.log(`[init-victim-repo] baseline  ${short(baseline.commitSha)}`);

  const baselineEntry: ManifestEntry = {
    sha: baseline.commitSha,
    short_sha: short(baseline.commitSha),
    message: 'chore: bootstrap checkout-api service',
    committed_at: baseAt.ms,
  };

  // 2) one bad-deploy commit per mode, stacked on main
  const modeEntries = {} as Record<Mode, ManifestEntry>;
  let parentCommit = baseline.commitSha;
  let parentTree = baseline.treeSha;
  const minsFor: Record<Mode, number> = { bad_deploy: 30, slow_db: 20, config_error: 10 };
  for (const bc of BAD_COMMITS) {
    const when = at(minsFor[bc.mode]);
    const result = await commitTree(
      bc.message,
      { [bc.path]: bc.content },
      parentCommit,
      parentTree,
      when.iso,
    );
    await upsertMainRef(result.commitSha);
    modeEntries[bc.mode] = {
      sha: result.commitSha,
      short_sha: short(result.commitSha),
      message: bc.message,
      committed_at: when.ms,
    };
    parentCommit = result.commitSha;
    parentTree = result.treeSha;
    console.log(`[init-victim-repo] ${bc.mode.padEnd(13)} ${short(result.commitSha)}`);
  }

  // 3) manifest (mode → real bad SHA) for the victim + demo control
  const manifest = {
    repo: `${OWNER}/${REPO}`,
    url: `https://github.com/${OWNER}/${REPO}`,
    default_branch: DEFAULT_BRANCH,
    generated_at: now,
    baseline: baselineEntry,
    modes: modeEntries,
    head: parentCommit,
  };
  const manifestPath = join(REPO_ROOT, 'data/victim-manifest.json');
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[init-victim-repo] manifest → ${manifestPath}`);

  // 4) deploys rows in the platform DB
  await recordDeploys(baselineEntry, modeEntries);

  console.log('\n[init-victim-repo] DONE');
  console.log(`  repo:        ${manifest.url}`);
  console.log(`  baseline:    ${baselineEntry.sha}`);
  console.log(`  bad_deploy:  ${modeEntries.bad_deploy.sha}`);
  console.log(`  slow_db:     ${modeEntries.slow_db.sha}`);
  console.log(`  config_error:${modeEntries.config_error.sha}`);
  console.log(`  Actions:     ${manifest.url}/actions`);
}

main().catch((err) => {
  console.error('[init-victim-repo] FAILED:', err);
  process.exit(1);
});
