import type { FastifyInstance } from 'fastify';
import { MetricsQuerySchema } from '@oncall/shared';
import type { AppContext } from '../app.js';
import { buildMetricsSnapshot } from '../metrics/index.js';
import { currentCustomer } from '../github/session.js';
import { sendError } from '../http/errors.js';

/**
 * `GET /api/v1/metrics?service=&window_sec=&resolution_sec=` (SPEC §7.2, FR-04).
 * Returns the current + baseline rollup and the persisted `metric_samples` series
 * (capped 240). `404 not_found` when the service is unknown.
 */
export function registerMetricsRoute(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  app.get('/api/v1/metrics', async (req, reply) => {
    const parsed = MetricsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid metrics query', {
        issues: parsed.error.issues,
      });
    }
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to view metrics');
    }
    const { service, window_sec, resolution_sec } = parsed.data;
    const snapshot = buildMetricsSnapshot(db, customer.id, {
      service,
      window_sec,
      resolution_sec,
      now: Date.now(),
    });
    if (!snapshot) {
      return sendError(reply, 404, 'not_found', `Service "${service}" not found`);
    }
    return reply.code(200).send(snapshot);
  });
}
