import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { currentCustomer } from '../github/session.js';

/**
 * Integration snippet route (SPEC §7.6, FR-02).
 *
 * `GET /api/v1/integration-snippet` → the ingest URL + key and the ready-to-paste
 * SDK middleware / tailer snippets the onboarding flow shows once a repo is
 * selected. The key is the calling customer's `ingest_api_key` (session or, under
 * `DEV_NO_AUTH`, the seed customer), falling back to the configured key.
 */

export function registerIntegrationSnippetRoute(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  const { db, config } = ctx;

  app.get('/api/v1/integration-snippet', (req, reply) => {
    const customer = currentCustomer(req, db, config);
    const apiKey = customer?.ingest_api_key ?? config.ingest.apiKey;
    const ingestUrl = `${config.server.publicBaseUrl.replace(/\/+$/, '')}/api/v1/ingest`;

    return reply.code(200).send({
      ingest_url: ingestUrl,
      ingest_api_key: apiKey,
      middleware_snippet:
        `import { oncall } from '@oncall/sdk'; ` +
        `app.use(oncall({ apiKey: '${apiKey}', service: 'checkout-api' }))`,
      tailer_snippet: `npx oncall-tail --file ./app.log --service checkout-api --key ${apiKey}`,
    });
  });
}
