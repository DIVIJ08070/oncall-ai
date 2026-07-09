import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Config } from './config.js';
import type { OncallDb } from './db/index.js';
import type { Broker } from './sse/broker.js';
import { errorBody, codeForStatus } from './http/errors.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerRepoRoutes } from './routes/repos.js';
import { registerIntegrationSnippetRoute } from './routes/integration-snippet.js';
import { registerServicesRoute } from './routes/services.js';
import { registerMetricsRoute } from './routes/metrics.js';
import { registerLogsRoutes } from './routes/logs.js';
import { registerIncidentRoutes } from './routes/incidents.js';
import { createGithubGateway, type GithubGateway } from './github/gateway.js';
import {
  createInvestigationService,
  type InvestigationService,
} from './investigation/service.js';
import type { ChatResponder } from './chat/handler.js';

/**
 * Fastify instance assembly (SPEC §3 `app.ts`). Wires the C1 `Config`, the C2
 * data layer (`OncallDb`), and the SSE `Broker` into one app context that route
 * modules read from. C3 registers `/health` + `POST /api/v1/ingest`; C9 adds the
 * GitHub OAuth / repo / integration-snippet routes; C10 registers its read/stream
 * routes onto the same instance via `AppContext`.
 */

export interface AppContext {
  config: Config;
  db: OncallDb;
  broker: Broker;
  /** GitHub OAuth/repo gateway (C9). Defaults to the real fetch+Octokit gateway;
   *  tests inject a fake so `.inject()` needs no network. */
  github?: GithubGateway;
  /** Investigation runner (C10). Boot shares one instance with the detection loop;
   *  when absent `buildApp` builds a default. Tests inject one with a fake engine. */
  investigation?: InvestigationService;
  /** Read-only chat responder (C10, §7.4). Defaults to the grounded responder. */
  chatResponder?: ChatResponder;
}

/** Body limit sized for a full 500-event batch (each stack up to 8 KB). */
const BODY_LIMIT_BYTES = 16 * 1024 * 1024;

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    // Ingest is server-to-server; drop the client IP dependency for the demo.
    trustProxy: true,
  });

  // CORS for the dashboard origin (read APIs + onboarding land in C9/C10).
  await app.register(cors, {
    origin: ctx.config.server.dashboardUrl,
    credentials: true,
  });

  // Normalize every framework/route error to the SPEC §7 error body.
  app.setErrorHandler((err, _req, reply) => {
    const status =
      typeof err.statusCode === 'number' && err.statusCode >= 400
        ? err.statusCode
        : 500;
    reply
      .code(status)
      .send(errorBody(codeForStatus(status), err.message || 'Internal Server Error'));
  });

  app.setNotFoundHandler((req, reply) => {
    reply
      .code(404)
      .send(errorBody('not_found', `Route ${req.method} ${req.url} not found`));
  });

  // Ensure an investigation runner exists so the read/stream routes + the manual
  // re-trigger work even when the caller (tests) didn't provide one.
  ctx.investigation ??= createInvestigationService({
    db: ctx.db,
    config: ctx.config,
    broker: ctx.broker,
  });

  registerHealthRoutes(app);
  registerIngestRoutes(app, ctx);

  // C9 — GitHub OAuth + repo onboarding + integration snippet (SPEC §7.5/§7.6).
  const github = ctx.github ?? createGithubGateway(ctx.config);
  registerAuthRoutes(app, ctx, github);
  registerRepoRoutes(app, ctx, github);
  registerIntegrationSnippetRoute(app, ctx);

  // C10 — read/stream surface the dashboard consumes (SPEC §7.2/§7.2b/§7.3/§7.4).
  registerServicesRoute(app, ctx);
  registerMetricsRoute(app, ctx);
  registerLogsRoutes(app, ctx);
  registerIncidentRoutes(app, ctx);

  return app;
}
