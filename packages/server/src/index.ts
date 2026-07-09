import { pathToFileURL } from 'node:url';
import { initConfig, type Config } from './config.js';
import { openDatabase, type OncallDb } from './db/index.js';
import type { CustomerRow } from './db/rows.js';
import { createBroker } from './sse/broker.js';
import { buildApp } from './app.js';

/**
 * Platform server boot (SPEC §3 `index.ts`). For C3 this wires config → db →
 * broker → Fastify app and serves `POST /api/v1/ingest` (+ `/health`). The
 * detection loop, merge poller, and read/stream routes are added by later chunks
 * onto the same `AppContext`.
 */

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
