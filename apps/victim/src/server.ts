/**
 * OnCall AI demo victim — Express server (SPEC §12).
 *
 * A small "customer" app with three switchable failure modes that ships telemetry
 * to the OnCall AI platform via the vendored, fail-silent `telemetry.ts` (FR-02,
 * NFR-04). The in-memory failure switch is flipped through `/__control/*` (§7.7);
 * under load, flipping to a failing mode produces the error/latency signal the
 * platform's 15s detector needs.
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { config } from './config.js';
import { oncall } from './telemetry.js';
import { registerControl } from './control.js';
import { checkoutRouter } from './routes/checkout.js';
import { reportsRouter } from './routes/reports.js';
import { pricingRouter } from './routes/pricing.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // Telemetry: one `info` per request + one `error` per failure (with stack).
  const telemetry = oncall({
    apiKey: config.apiKey,
    service: config.service,
    ingestUrl: config.ingestUrl,
  });
  app.use(telemetry);

  // Liveness (used by CI smoke + local checks).
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: config.service });
  });

  // Demo control plane (§7.7).
  registerControl(app);

  // Business routes — each is the target of one failure mode.
  app.use('/api/checkout', checkoutRouter); // bad_deploy (null-ref)
  app.use('/api/reports', reportsRouter); //   slow_db
  app.use('/api/pricing', pricingRouter); //   config_error

  // Ship the error (with stack) BEFORE responding.
  app.use(telemetry.errorHandler);

  // Final error responder — normalized 500 body.
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
      `[victim] ${config.service} listening on http://localhost:${config.port} ` +
        `→ shipping telemetry to ${config.ingestUrl}`,
    );
  });
}
