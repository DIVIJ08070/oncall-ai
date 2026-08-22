import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import {
  INGEST_KEY_HEADER,
  authenticateIngest,
  extractIngestKey,
} from '../ingest/auth.js';
import { writeBatch, writeHostMetrics } from '../ingest/writer.js';
import { sendError } from '../http/errors.js';

/**
 * `POST /api/v1/ingest` (SPEC §7.1, FR-01/02/03).
 *
 * Auth: `x-ingest-key` → customer (401 on missing/invalid). Batch envelope is
 * validated → 400 `validation_error` on a malformed batch. The body carries
 * `events` (log/request telemetry) and/or `host_metrics` (HOST early-warning
 * readings — CPU/Mem/DB-pool); at least one non-empty array is required. Valid
 * batches always return `202 { accepted, rejected, errors }`; individual invalid
 * items are rejected per-index without failing the whole request.
 */

/** Batch envelope only — individual items are validated in the writer. */
const IngestEnvelopeSchema = z
  .object({
    events: z.array(z.unknown()).max(500).optional(),
    host_metrics: z.array(z.unknown()).max(500).optional(),
  })
  .refine(
    (b) => (b.events?.length ?? 0) > 0 || (b.host_metrics?.length ?? 0) > 0,
    { message: 'body must include a non-empty `events` or `host_metrics` array' },
  );

export function registerIngestRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.post('/api/v1/ingest', async (req, reply) => {
    const key = extractIngestKey(req.headers[INGEST_KEY_HEADER]);
    const customer = await authenticateIngest(ctx.db, key);
    if (!customer) {
      return sendError(
        reply,
        401,
        'unauthorized',
        'Missing or invalid x-ingest-key',
      );
    }

    const envelope = IngestEnvelopeSchema.safeParse(req.body);
    if (!envelope.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid ingest batch', {
        issues: envelope.error.issues,
      });
    }

    const deps = { db: ctx.db, broker: ctx.broker };
    const { events, host_metrics } = envelope.data;

    // Log/request telemetry (SPEC §7.1) and HOST early-warning readings share
    // the endpoint but write to different tables. Normally a caller sends one or
    // the other; when both are present the accepted/rejected counts sum.
    const logResult = events && events.length > 0
      ? await writeBatch(deps, customer, events)
      : { accepted: 0, rejected: 0, errors: [] };
    const hostResult = host_metrics && host_metrics.length > 0
      ? await writeHostMetrics(deps, customer, host_metrics)
      : { accepted: 0, rejected: 0, errors: [] };

    return reply.code(202).send({
      accepted: logResult.accepted + hostResult.accepted,
      rejected: logResult.rejected + hostResult.rejected,
      errors: [...logResult.errors, ...hostResult.errors],
    });
  });
}
