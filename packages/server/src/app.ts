import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Config } from './config.js';
import type { OncallDb } from './db/index.js';
import type { Broker } from './sse/broker.js';
import { errorBody, codeForStatus } from './http/errors.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerIngestRoutes } from './routes/ingest.js';

/**
 * Fastify instance assembly (SPEC §3 `app.ts`). Wires the C1 `Config`, the C2
 * data layer (`OncallDb`), and the SSE `Broker` into one app context that route
 * modules read from. C3 registers `/health` + `POST /api/v1/ingest`; later chunks
 * (C9/C10) register their routes onto the same instance via `AppContext`.
 */

export interface AppContext {
  config: Config;
  db: OncallDb;
  broker: Broker;
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

  registerHealthRoutes(app);
  registerIngestRoutes(app, ctx);

  return app;
}
