import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import {
  INGEST_KEY_HEADER,
  authenticateIngest,
  extractIngestKey,
} from '../ingest/auth.js';
import { writeBatch } from '../ingest/writer.js';
import { sendError } from '../http/errors.js';

/**
 * `POST /api/v1/ingest` (SPEC §7.1, FR-01/02/03).
 *
 * Auth: `x-ingest-key` → customer (401 on missing/invalid). Batch envelope is
 * validated (1..500 events) → 400 `validation_error` on a malformed batch.
 * Valid batches always return `202 { accepted, rejected, errors }`; individual
 * invalid events are rejected per-index without failing the whole request.
 */

/** Batch envelope only — individual events are validated in the writer. */
const IngestEnvelopeSchema = z.object({
  events: z.array(z.unknown()).min(1).max(500),
});

export function registerIngestRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.post('/api/v1/ingest', (req, reply) => {
    const key = extractIngestKey(req.headers[INGEST_KEY_HEADER]);
    const customer = authenticateIngest(ctx.db, key);
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

    const result = writeBatch(
      { db: ctx.db, broker: ctx.broker },
      customer,
      envelope.data.events,
    );
    return reply.code(202).send(result);
  });
}
