/**
 * OnCall AI demo victim — Express server (SPEC §12).
 *
 * A realistic multi-service "customer" AI commerce platform. Every service in the
 * registry (`src/services/index.ts`) mounts its OWN telemetry tagged with its own
 * service name, so the platform — which groups events by (service, endpoint) —
 * renders a rich dashboard with many services and endpoints (FR-02, NFR-04).
 *
 * The original three switchable failure modes are preserved verbatim under the
 * "checkout-api" service: flipping the in-memory switch via `/__control/*` (§7.7)
 * produces the error/latency signal the platform's 15s detector needs.
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { config } from './config.js';
import { oncall } from './telemetry.js';
import { registerControl } from './control.js';
import { SERVICES, mountService } from './services/index.js';
import { startSelfTraffic } from './traffic.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // Platform plane (health + demo control) — its own telemetry, tagged
  // "platform-api", scoped to just these paths so no business request is
  // double-counted. (No single global request-logger exists anymore.)
  const platform = oncall({
    apiKey: config.apiKey,
    service: 'platform-api',
    ingestUrl: config.ingestUrl,
  });

  // Liveness (used by CI smoke + local checks).
  app.get('/health', platform, (_req, res) => {
    res.status(200).json({ status: 'ok', service: config.service });
  });

  // Demo control plane (§7.7) — telemetry scoped to /__control only.
  app.use('/__control', platform);
  registerControl(app);
  app.use('/__control', platform.errorHandler);

  // Business services — each mounts its own telemetry tagged with its own name.
  // checkout/reports/pricing stay under "checkout-api" with unchanged behavior.
  for (const def of SERVICES) mountService(app, def);

  // Single global final error responder — normalized 500 body. (Per-service
  // `tel.errorHandler` has already shipped the error with its stack.)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    if (res.headersSent) return;
    res.status(500).json({ error: { code: 'internal', message } });
  });

  return app;
}

/** Boot when run directly (not when imported by tests). */
function isMain(): boolean {
  const entry = process.argv[1] ?? '';
  return (
    entry.endsWith('server.ts') ||
    entry.endsWith('server.js') ||
    entry.endsWith('/dist/server.js')
  );
}

if (isMain()) {
  const app = createApp();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[victim] AI commerce platform listening on http://localhost:${config.port} ` +
        `→ shipping telemetry to ${config.ingestUrl} ` +
        `(${SERVICES.length} service mounts)`,
    );
    // Optional built-in self-traffic generator (OFF by default). When enabled it
    // drives a realistic multi-service request mix against this app's own
    // endpoints so the platform dashboard stays alive during a demo.
    if (process.env.VICTIM_SELF_TRAFFIC === '1') {
      startSelfTraffic(config.port);
      // eslint-disable-next-line no-console
      console.log('[victim] self-traffic generator ON (~6–12 req/s across all services)');
    }
  });
}
