import { pathToFileURL } from 'node:url';
import { initConfig, type Config } from './config.js';
import { openDatabase, type OncallDb } from './db/index.js';
import type { CustomerRow } from './db/rows.js';
import { createBroker, type Broker } from './sse/broker.js';
import { buildApp } from './app.js';
import { createMergePoller, createPlatformOctokit, type MergePoller } from './github/index.js';

/**
 * Platform server boot (SPEC §3 `index.ts`). Wires config → db → broker →
 * Fastify app (ingest + OAuth/repo/snippet routes) and, when a `GITHUB_TOKEN` is
 * present, starts the C9 merge poller + recovery verifier (SPEC §10.5). The C10
 * detection loop is added onto the same `AppContext` later — see the note below.
 */

/**
 * Start the merge poller (SPEC §10.5, FR-12) when a PAT is configured.
 *
 * **Recovery ownership:** the poller owns the `verifying → resolved|escalated`
 * transitions end-to-end (window + PR comment). When C10 starts the detection
 * loop alongside this, that `DetectionEngine` MUST be constructed with
 * `recoveryVerifier: null` so recovery is driven from exactly one place.
 */
export function startMergePoller(
  db: OncallDb,
  config: Config,
  broker: Broker,
): MergePoller | null {
  if (!config.github.token) {
    // eslint-disable-next-line no-console
    console.log('[oncall] merge poller disabled (no GITHUB_TOKEN)');
    return null;
  }
  const poller = createMergePoller({
    db,
    config,
    broker,
    octokit: createPlatformOctokit(config),
    logger: (msg, meta) =>
      // eslint-disable-next-line no-console
      meta ? console.log(msg, meta) : console.log(msg),
  });
  poller.start();
  return poller;
}

/**
 * Idempotent dev convenience: ensure a customer exists for the configured
 * `INGEST_API_KEY` so the ingest endpoint is usable end-to-end immediately.
 * `scripts/seed.ts` (later chunk) supersedes this with the full demo seed.
 */
export function ensureSeedCustomer(db: OncallDb, config: Config): CustomerRow {
  const existing = db.dao.customers.getByIngestKey(config.ingest.apiKey);
  if (existing) return existing;
  return db.dao.customers.create({
    name: 'demo',
    ingest_api_key: config.ingest.apiKey,
    github_owner: config.github.owner,
    github_repo: config.github.repo,
    default_branch: config.github.defaultBranch,
  });
}

export async function main(): Promise<void> {
  const config = await initConfig();
  const db = openDatabase(config.server.databaseUrl);
  ensureSeedCustomer(db, config);

  const broker = createBroker();
  const app = await buildApp({ config, db, broker });

  startMergePoller(db, config, broker);

  await app.listen({ port: config.server.port, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.log(
    `[oncall] platform listening on :${config.server.port} — POST /api/v1/ingest ready`,
  );
}

// Boot only when executed directly (`node dist/index.js` / `tsx src/index.ts`).
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[oncall] fatal boot error', err);
    process.exit(1);
  });
}
