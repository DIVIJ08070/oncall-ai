/**
 * scripts/seed.ts — platform-side demo seeder (`npm run seed`).
 *
 * Idempotent convenience seeder for the *platform* side of the demo. It ensures
 * a demo customer row exists for the configured `INGEST_API_KEY` using the exact
 * same DAO path the server runs at boot (`ensureSeedCustomer`, SPEC §7.1 / FR-01),
 * then prints the ingest key + ingest URL and points you at the next step.
 *
 * It deliberately does NOT duplicate `scripts/init-victim-repo.ts`: that script
 * owns the *victim git history* seed (creating `OWNER/REPO`, pushing the baseline +
 * one bad-deploy commit per failure mode, and recording the `deploys` manifest).
 * This one only seeds the platform customer so `POST /api/v1/ingest` is usable
 * immediately, and tells you what to run next.
 *
 * Running it repeatedly is safe — the customer is keyed on `INGEST_API_KEY`, so a
 * second run reports "already present" and changes nothing.
 *
 * Prereq: build the workspace first so the compiled server layer is importable
 *   (`npm run build`).
 * Run:    `npm run seed`   (equivalently: `npx tsx scripts/seed.ts`).
 */

import { initConfig } from '../packages/server/dist/config.js';
import { openDatabase } from '../packages/server/dist/db/index.js';
import { ensureSeedCustomer } from '../packages/server/dist/index.js';

async function main(): Promise<void> {
  // `initConfig()` bootstraps `.env` into `process.env` then validates/defaults
  // the full SPEC §14 contract — the same config the server boots with.
  const config = await initConfig();
  const db = openDatabase(config.server.databaseUrl);

  try {
    // Distinguish "created" from "already present" for a friendlier message,
    // then ensure via the shared server helper (idempotent, keyed on the key).
    const existed = db.dao.customers.getByIngestKey(config.ingest.apiKey) !== null;
    const customer = ensureSeedCustomer(db, config);

    // Canonical ingest URL — assembled exactly like GET /api/v1/integration-snippet.
    const ingestUrl = `${config.server.publicBaseUrl.replace(/\/+$/, '')}/api/v1/ingest`;

    const line = '─'.repeat(64);
    console.log(line);
    console.log(existed ? '✓ Demo customer already present (no change).' : '✓ Demo customer created.');
    console.log(line);
    console.log(`  customer id     : ${customer.id}`);
    console.log(`  customer name   : ${customer.name}`);
    console.log(`  ingest api key  : ${customer.ingest_api_key}`);
    console.log(`  ingest url      : ${ingestUrl}`);
    console.log(`  auth header     : x-ingest-key: ${customer.ingest_api_key}`);
    console.log(`  github repo     : ${customer.github_owner ?? '(unset)'}/${customer.github_repo ?? '(unset)'}`);
    console.log(`  database        : ${db.path}`);
    console.log(line);
    console.log('Next step — seed the victim repo git history + deploy manifest:');
    console.log('  npx tsx scripts/init-victim-repo.ts');
    console.log('(requires GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO in .env; see README).');
    console.log(line);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
