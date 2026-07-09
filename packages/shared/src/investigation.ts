import { z } from 'zod';

/**
 * Investigation domain (SPEC §7.3 feed, §8 `investigation_sessions` & `investigation_steps`, §9 loop).
 */

/** Confidence is a 0–1 real (SPEC §8, FR-08/13). */
export const ConfidenceSchema = z.number().min(0).max(1);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Investigation-step kind (SPEC §8 `investigation_steps.type`, NFR-06). */
export const StepTypeSchema = z.enum([
  'thought',
  'tool_call',
  'tool_result',
  'conclusion',
  'error',
]);
export type StepType = z.infer<typeof StepTypeSchema>;

/** Session run status (SPEC §8 `investigation_sessions.status`). */
export const SessionStatusSchema = z.enum([
  'running',
  'completed',
  'escalated',
  'failed',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** Which engine produced the session (SPEC §9 factory, §13). */
export const SessionModeSchema = z.enum(['live', 'cached']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

/** Terminal decision from `submit_findings` (SPEC §9). */
export const DecisionSchema = z.enum(['propose_fix', 'escalate']);
export type Decision = z.infer<typeof DecisionSchema>;

/**
 * One persisted + streamed investigation step (SPEC §8 `investigation_steps`, §7.3 `step` frame).
 * `tool_input`/`tool_output` are already-bounded JSON payloads.
 */
export const StepSchema = z.object({
  id: z.string().optional(),
  session_id: z.string().optional(),
  seq: z.number().int(),
  type: StepTypeSchema,
  tool_name: z.string().nullish(),
  tool_input: z.unknown().nullish(),
  tool_output: z.unknown().nullish(),
  content: z.string().nullish(),
  created_at: z.number().int().optional(),
  ts: z.number().int().optional(),
});
export type Step = z.infer<typeof StepSchema>;
/** Alias — the fuller name used across server/agent code. */
export type InvestigationStep = Step;
export const InvestigationStepSchema = StepSchema;

/** An investigation session (SPEC §8 `investigation_sessions`, §7.3 `session`). */
export const SessionSchema = z.object({
  id: z.string(),
  incident_id: z.string(),
  status: SessionStatusSchema,
  mode: SessionModeSchema,
  model: z.string(),
  started_at: z.number().int(),
  completed_at: z.number().int().nullable(),
  iterations: z.number().int(),
  root_cause: z.string().nullable(),
  confidence: ConfidenceSchema.nullable(),
  decision: DecisionSchema.nullable(),
  summary: z.string().nullable(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cost_usd: z.number(),
});
export type Session = z.infer<typeof SessionSchema>;
/** Alias — the fuller name used across server/agent code. */
export type InvestigationSession = Session;
export const InvestigationSessionSchema = SessionSchema;

/** Structured evidence attached to a finding / chat answer (SPEC §9 `submit_findings`, §7.4). */
export const EvidenceRefSchema = z.object({
  type: z.string(),
  tool: z.string().optional(),
  ref: z.string(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

/**
 * Result returned by `InvestigationEngine.investigate()` (SPEC §9 `SessionResult`).
 * The engine writes a session + steps to the DB; this is the in-memory summary.
 */
export const SessionResultSchema = z.object({
  session_id: z.string(),
  status: SessionStatusSchema,
  mode: SessionModeSchema,
  model: z.string(),
  iterations: z.number().int(),
  root_cause: z.string().nullable(),
  confidence: ConfidenceSchema.nullable(),
  decision: DecisionSchema.nullable(),
  cost_usd: z.number(),
  pr_number: z.number().int().nullish(),
  pr_url: z.string().nullish(),
});
export type SessionResult = z.infer<typeof SessionResultSchema>;
