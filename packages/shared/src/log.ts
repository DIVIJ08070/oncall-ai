import { z } from 'zod';

/**
 * Log domain (SPEC §7.1 ingest wire event, §7.2b logs API, §8 `log_events`).
 */

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Wire event accepted by `POST /api/v1/ingest` (SPEC §7.1).
 * `service`, `level`, `message` are required; all other fields are nullable.
 * `timestamp` defaults to server receive time when omitted.
 */
export const LogEventInputSchema = z.object({
  timestamp: z.number().int().nonnegative().optional(),
  service: z.string().min(1),
  level: LogLevelSchema,
  message: z.string(),
  stack: z.string().nullish(),
  endpoint: z.string().nullish(),
  method: z.string().nullish(),
  status: z.number().int().nullish(),
  latency_ms: z.number().int().nullish(),
});
export type LogEventInput = z.infer<typeof LogEventInputSchema>;

/**
 * Stored / API-returned log event (SPEC §7.2b `GET /logs`, SSE `log` frame, §8 `log_events`).
 * Nullable columns are represented as `T | null`.
 */
export const LogEventSchema = z.object({
  id: z.string(),
  service: z.string(),
  timestamp: z.number().int(),
  received_at: z.number().int(),
  level: LogLevelSchema,
  message: z.string(),
  stack: z.string().nullable(),
  endpoint: z.string().nullable(),
  method: z.string().nullable(),
  status: z.number().int().nullable(),
  latency_ms: z.number().int().nullable(),
  fingerprint_sig: z.string().nullable(),
});
export type LogEvent = z.infer<typeof LogEventSchema>;
