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
  /** Inbound body size (bytes, from request `content-length`); projected into
   *  `api_request_samples.request_size`. Nullable — not every request reports it. */
  request_size: z.number().int().nullish(),
  /** Outbound body size (bytes, from response `content-length`); projected into
   *  `api_request_samples.response_size`. Nullable — chunked responses omit it. */
  response_size: z.number().int().nullish(),
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

/**
 * Raw per-request telemetry sample (AI Incident PREVENTION Phase 1).
 *
 * The dedicated wire/storage shape behind `api_request_samples` — one row per
 * observed API request, the raw source the performance ticker rolls up each
 * window (percentiles, error/timeout rates, RPS). The victim services already
 * ship this same signal (endpoint, method, status, latency) inside their ingest
 * log events; the ingest writer projects those into `api_request_samples`.
 * `service_name`, `endpoint`, `method`, and `timestamp` are required; the size /
 * status / duration fields are nullable (not every request reports them).
 */
export const ApiRequestSchema = z.object({
  service_name: z.string().min(1),
  endpoint: z.string().min(1),
  method: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  status_code: z.number().int().nullish(),
  duration_ms: z.number().nullish(),
  request_size: z.number().int().nullish(),
  response_size: z.number().int().nullish(),
});
export type ApiRequestPayload = z.infer<typeof ApiRequestSchema>;
