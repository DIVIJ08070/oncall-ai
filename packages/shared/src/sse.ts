import { z } from 'zod';
import { LogEventSchema } from './log.js';
import {
  StepSchema,
  SessionModeSchema,
  SessionStatusSchema,
  DecisionSchema,
  ConfidenceSchema,
} from './investigation.js';
import { PrKindSchema } from './github.js';

/**
 * SSE event union types (SPEC §7.2b logs stream, §7.3 investigation feed, §7.4 chat stream).
 * Wire frames are `event: <event>\ndata: <JSON of data>\n\n` plus a `:heartbeat` comment.
 */

/** Emitted on every stream as a keep-alive (SPEC §7 conventions). */
export const HeartbeatEventSchema = z.object({
  event: z.literal('heartbeat'),
  data: z.object({ ts: z.number().int() }),
});
export type HeartbeatEvent = z.infer<typeof HeartbeatEventSchema>;

/* ── Logs stream: GET /logs/stream (SPEC §7.2b) ─────────────────────────── */

export const LogStreamEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('log'), data: LogEventSchema }),
  HeartbeatEventSchema,
]);
export type LogStreamEvent = z.infer<typeof LogStreamEventSchema>;

/* ── Investigation feed: GET /incidents/:id/feed (SPEC §7.3) ─────────────── */

export const SessionStartedDataSchema = z.object({
  session_id: z.string(),
  mode: SessionModeSchema,
  model: z.string(),
});
export type SessionStartedData = z.infer<typeof SessionStartedDataSchema>;

export const PrCreatedDataSchema = z.object({
  number: z.number().int(),
  url: z.string(),
  kind: PrKindSchema,
});
export type PrCreatedData = z.infer<typeof PrCreatedDataSchema>;

export const ConclusionDataSchema = z.object({
  root_cause: z.string(),
  confidence: ConfidenceSchema,
  decision: DecisionSchema,
});
export type ConclusionData = z.infer<typeof ConclusionDataSchema>;

export const SessionCompletedDataSchema = z.object({
  status: SessionStatusSchema,
  cost_usd: z.number(),
  iterations: z.number().int(),
});
export type SessionCompletedData = z.infer<typeof SessionCompletedDataSchema>;

export const FeedErrorDataSchema = z.object({ message: z.string() });
export type FeedErrorData = z.infer<typeof FeedErrorDataSchema>;

/** Sent first to late subscribers: the persisted steps so far (SPEC §7.3). */
export const ReplayDataSchema = z.object({ steps: z.array(StepSchema) });
export type ReplayData = z.infer<typeof ReplayDataSchema>;

export const FeedEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('replay'), data: ReplayDataSchema }),
  z.object({ event: z.literal('session_started'), data: SessionStartedDataSchema }),
  z.object({ event: z.literal('step'), data: StepSchema }),
  z.object({ event: z.literal('pr_created'), data: PrCreatedDataSchema }),
  z.object({ event: z.literal('conclusion'), data: ConclusionDataSchema }),
  z.object({ event: z.literal('session_completed'), data: SessionCompletedDataSchema }),
  z.object({ event: z.literal('error'), data: FeedErrorDataSchema }),
  HeartbeatEventSchema,
]);
export type FeedEvent = z.infer<typeof FeedEventSchema>;

/* ── Chat stream: GET /incidents/:id/chat/stream (SPEC §7.4) ─────────────── */

export const ChatStreamEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('token'), data: z.object({ text: z.string() }) }),
  z.object({ event: z.literal('done'), data: z.object({ content: z.string() }) }),
  HeartbeatEventSchema,
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

/** All SSE event names used across the platform. */
export const SSE_EVENT_NAMES = [
  'log',
  'heartbeat',
  'replay',
  'session_started',
  'step',
  'pr_created',
  'conclusion',
  'session_completed',
  'error',
  'token',
  'done',
] as const;
export type SseEventName = (typeof SSE_EVENT_NAMES)[number];
