import {
  SubmitFindingsInputSchema,
  type SubmitFindingsInput,
  type SubmitFindingsOutput,
} from '@oncall/shared';
import type { ToolContext } from '../ports.js';

/**
 * Control tool — `submit_findings` (SPEC §9 loop control). The 7th allowlisted
 * SDK tool; it performs **no repo action**. Calling it ends the investigation:
 * the loop (C7) writes `investigation_sessions.{root_cause,confidence,decision}`
 * (FR-08) and emits the `conclusion` SSE event. Here we surface the conclusion
 * through the sink so the live feed updates the moment the agent concludes.
 */
export async function submitFindings(
  ctx: ToolContext,
  input: SubmitFindingsInput,
): Promise<SubmitFindingsOutput> {
  await ctx.sink.conclusion?.({
    root_cause: input.root_cause,
    confidence: input.confidence,
    decision: input.decision,
  });
  return { acknowledged: true };
}

export const submitFindingsMeta = {
  name: 'submit_findings' as const,
  description:
    'End the investigation with a structured conclusion: root_cause, evidence[], confidence (0–1), and decision ("propose_fix" | "escalate"). Performs no repo action — call it exactly once when you are done.',
  inputSchema: SubmitFindingsInputSchema,
};
