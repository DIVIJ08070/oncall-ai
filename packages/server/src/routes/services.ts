import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { buildServicesResponse } from '../metrics/index.js';
import { currentCustomer } from '../github/session.js';
import { sendError } from '../http/errors.js';

/**
 * `GET /api/v1/services` (SPEC §7.2, FR-04/14). Health badge + current metrics per
 * service for the dashboard's `ServiceHealth` (polled every 5 s). Read API: uses
 * the session customer, or the seed customer under `DEV_NO_AUTH` (SPEC §6).
 */
export function registerServicesRoute(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  app.get('/api/v1/services', async (req, reply) => {
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to view services');
    }
    const body = buildServicesResponse(db, customer.id, Date.now(), config);
    return reply.code(200).send(body);
  });
}
