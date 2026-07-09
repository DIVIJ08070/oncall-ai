import { pathToFileURL } from 'node:url';
import { initConfig, type Config } from './config.js';
import { openDatabase, type OncallDb } from './db/index.js';
import type { CustomerRow } from './db/rows.js';
import { createBroker, type Broker } from './sse/broker.js';
import { buildApp } from './app.js';
import { createMergePoller, createPlatformOctokit, type MergePoller } from './github/index.js';
import { createDetectionEngine, type DetectionEngine } from './detection/index.js';
import {
  createInvestigationService,
  type InvestigationService,
} from './investigation/service.js';
import { createSlackNotifier } from './notify/index.js';

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
 * Start the detection engine (SPEC §10, FR-05/06/19) — the 15 s loop that rolls
 * up metrics, opens/dedups incidents, and auto-heals. It is wired with:
 *   - the real **investigation enqueuer** (C7 engine, FR-06) so a newly-opened
 *     incident auto-starts an investigation whose session + steps persist and
 *     stream on the feed;
 *   - the FR-17 **Slack notifier** (`notify/`);
 *   - `recoveryVerifier: null` — recovery (`verifying → resolved|escalated`) is
 *     owned end-to-end by the C9 merge poller (one owner, per its integration note).
 */
export function startDetection(
  db: OncallDb,
  config: Config,
  broker: Broker,
  investigation: InvestigationService,
): DetectionEngine {
  const engine = createDetectionEngine({
    db,
    config,
    broker,
    notifier: createSlackNotifier({ db, config }),
    enqueuer: investigation.enqueuer(),
    recoveryVerifier: null,
    logger: (msg, meta) =>
      // eslint-disable-next-line no-console
      meta ? console.log(msg, meta) : console.log(msg),
  });
  engine.start();
  return engine;
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

  // One investigation runner shared by the read/stream routes (manual re-trigger)
  // and the detection loop (auto-start on incident open, FR-06).
  const investigation = createInvestigationService({ db, config, broker });

  const app = await buildApp({ config, db, broker, investigation });

  startDetection(db, config, broker, investigation);
  startMergePoller(db, config, broker);

  await app.listen({ port: config.server.port, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.log(
    `[oncall] platform listening on :${config.server.port} — dashboard read/stream API ready`,
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
