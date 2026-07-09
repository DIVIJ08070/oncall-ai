import type { FastifyInstance } from 'fastify';
import { LogsQuerySchema, type LogEvent } from '@oncall/shared';
import type { AppContext } from '../app.js';
import { currentCustomer } from '../github/session.js';
import { sendError } from '../http/errors.js';
import { logsTopic } from '../sse/broker.js';
import { startSse } from '../sse/sse-reply.js';

/**
 * Logs read + stream (SPEC §7.2b, FR-14).
 *
 * - `GET /api/v1/logs`        → filtered, keyset-paginated history (newest-first).
 * - `GET /api/v1/logs/stream` → live `log` frames over SSE (broker `logs/<service>`).
 */

/** Strip the internal `customer_id` so the wire shape is exactly `LogEvent`. */
function toLogEvent(row: LogEvent & { customer_id?: string }): LogEvent {
  const { customer_id: _omit, ...event } = row;
  return event;
}

export function registerLogsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config, broker } = ctx;

  app.get('/api/v1/logs', async (req, reply) => {
    const parsed = LogsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid logs query', {
        issues: parsed.error.issues,
      });
    }
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to view logs');
    }
    const { service, level, since, until, limit } = parsed.data;
    const rows = db.dao.logEvents.query({
      customer_id: customer.id,
      service,
      level,
      since,
      until,
      limit,
    });
    const events = rows.map(toLogEvent);
    // Keyset cursor for the next (older) page: the oldest ts in this page, or null
    // when the page wasn't full (no more history).
    const next_before =
      events.length === limit && events.length > 0
        ? events[events.length - 1].timestamp
        : null;
    return reply.code(200).send({ events, next_before });
  });

  app.get('/api/v1/logs/stream', (req, reply) => {
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to stream logs');
    }
    const service = (req.query as { service?: string }).service;

    // Subscribe to the requested service, or every current service for the customer.
    const serviceNames = service
      ? [service]
      : db.dao.services.listByCustomer(customer.id).map((s) => s.name);

    const channel = startSse(req, reply);
    const unsubs = serviceNames.map((name) =>
      broker.subscribe(logsTopic(name), (msg) => {
        channel.event(msg.event, msg.data);
      }),
    );
    channel.onClose(() => {
      for (const u of unsubs) u();
    });
  });
}
