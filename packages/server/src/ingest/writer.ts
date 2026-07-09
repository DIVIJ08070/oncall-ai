import { LogEventInputSchema, type IngestResponse } from '@oncall/shared';
import type { OncallDb } from '../db/index.js';
import type { CustomerRow } from '../db/rows.js';
import type { CreateLogEventInput } from '../db/dao/log-events.js';
import { type Broker, logsTopic } from '../sse/broker.js';
import { normalizeSignature } from './fingerprint.js';

/**
 * Ingest batch writer (SPEC §7.1, FR-01/02/03). Per-event validation against the
 * shared `LogEventInputSchema`, then a single-transaction batch insert of the
 * valid events. Side effects (SPEC §7.1):
 *   - writes `log_events` (stack truncated to 8 KB by the DAO; `fingerprint_sig`
 *     precomputed here per §8/§10.2);
 *   - advances `services.last_event_at` for each touched service;
 *   - publishes each stored event to the `logs/<service>` SSE topic (broker seam).
 *
 * Returns the SPEC §7.1 response body `{ accepted, rejected, errors }` — invalid
 * events are rejected individually (never failing the whole valid batch).
 */

export interface IngestDeps {
  db: OncallDb;
  broker: Broker;
}

/** Render zod issues into a compact, human-readable per-event message. */
function issueMessage(err: import('zod').ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

export function writeBatch(
  deps: IngestDeps,
  customer: CustomerRow,
  rawEvents: unknown[],
): IngestResponse {
  const receivedAt = Date.now();
  const toInsert: CreateLogEventInput[] = [];
  const errors: { index: number; message: string }[] = [];

  for (let i = 0; i < rawEvents.length; i++) {
    const parsed = LogEventInputSchema.safeParse(rawEvents[i]);
    if (!parsed.success) {
      errors.push({ index: i, message: issueMessage(parsed.error) });
      continue;
    }
    const e = parsed.data;
    toInsert.push({
      customer_id: customer.id,
      service: e.service,
      level: e.level,
      message: e.message,
      timestamp: e.timestamp ?? receivedAt,
      received_at: receivedAt,
      stack: e.stack ?? null,
      endpoint: e.endpoint ?? null,
      method: e.method ?? null,
      status: e.status ?? null,
      latency_ms: e.latency_ms ?? null,
      fingerprint_sig: normalizeSignature(e.message),
    });
  }

  // Persist (single transaction; DAO truncates stack to 8 KB + assigns ULIDs).
  const rows =
    toInsert.length > 0 ? deps.db.dao.logEvents.insertMany(toInsert) : [];

  // Advance service heartbeats: touch the earliest then the latest event ts per
  // service so `first_event_at` = min-seen and `last_event_at` = max-seen (the
  // DAO's touch is MIN/MAX-idempotent, so order only guarantees the final last).
  const earliestByService = new Map<string, number>();
  const latestByService = new Map<string, number>();
  for (const r of rows) {
    const e = earliestByService.get(r.service);
    if (e === undefined || r.timestamp < e) earliestByService.set(r.service, r.timestamp);
    const l = latestByService.get(r.service);
    if (l === undefined || r.timestamp > l) latestByService.set(r.service, r.timestamp);
  }
  for (const [service, ts] of earliestByService) {
    deps.db.dao.services.touch(customer.id, service, ts);
  }
  for (const [service, ts] of latestByService) {
    deps.db.dao.services.touch(customer.id, service, ts);
  }

  // Publish to the `logs/<service>` SSE topic (data = LogEvent, sans customer_id).
  for (const r of rows) {
    const { customer_id: _omit, ...logEvent } = r;
    deps.broker.publish(logsTopic(r.service), { event: 'log', data: logEvent });
  }

  return { accepted: rows.length, rejected: errors.length, errors };
}
