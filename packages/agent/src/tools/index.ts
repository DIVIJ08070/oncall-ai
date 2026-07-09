import { z } from 'zod';
import { AGENT_TOOL_NAMES, type AgentToolName } from '@oncall/shared';
import type { ToolContext } from '../ports.js';
import { searchLogs, searchLogsMeta } from './search_logs.js';
import { getMetrics, getMetricsMeta } from './get_metrics.js';
import { getRecentDeploys, getRecentDeploysMeta } from './get_recent_deploys.js';
import { getDeployDiff, getDeployDiffMeta } from './get_deploy_diff.js';
import { readFile, readFileMeta } from './read_file.js';
import { createFixPr, createFixPrMeta } from './create_fix_pr.js';
import { submitFindings, submitFindingsMeta } from './submit_findings.js';

/**
 * Tool registry (SPEC §9). One authoritative definition per allowlisted tool —
 * name, description, zod input schema, and a handler that **validates its input
 * against the schema before running**. C7's `mcp.ts` maps each definition to an
 * SDK `tool()`; the platform chat handler (C10) reuses the read-only subset.
 *
 * Every tool's output is already bounded inside the tool (`bounded.ts`); the
 * registry adds input validation so a malformed tool call is rejected in code,
 * not silently coerced.
 */

/** Re-export the per-tool functions for direct (typed) call sites. */
export {
  searchLogs,
  getMetrics,
  getRecentDeploys,
  getDeployDiff,
  readFile,
  createFixPr,
  submitFindings,
};
export {
  searchLogsMeta,
  getMetricsMeta,
  getRecentDeploysMeta,
  getDeployDiffMeta,
  readFileMeta,
  createFixPrMeta,
  submitFindingsMeta,
};

export interface ToolDefinition {
  name: AgentToolName;
  description: string;
  inputSchema: z.ZodTypeAny;
  /** Validate `rawInput` against `inputSchema`, then run. Throws `ZodError` on bad input. */
  handler(ctx: ToolContext, rawInput: unknown): Promise<unknown>;
}

function def<S extends z.ZodTypeAny, O>(
  meta: { name: AgentToolName; description: string; inputSchema: S },
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<O>,
): ToolDefinition {
  return {
    name: meta.name,
    description: meta.description,
    inputSchema: meta.inputSchema,
    handler: (ctx, rawInput) => run(ctx, meta.inputSchema.parse(rawInput) as z.infer<S>),
  };
}

/** All 7 allowlisted tools, in a stable order (SPEC §9). */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  def(searchLogsMeta, searchLogs),
  def(getMetricsMeta, getMetrics),
  def(getRecentDeploysMeta, getRecentDeploys),
  def(getDeployDiffMeta, getDeployDiff),
  def(readFileMeta, readFile),
  def(createFixPrMeta, createFixPr),
  def(submitFindingsMeta, submitFindings),
];

export const TOOL_BY_NAME: Record<AgentToolName, ToolDefinition> = Object.fromEntries(
  TOOL_DEFINITIONS.map((d) => [d.name, d]),
) as Record<AgentToolName, ToolDefinition>;

/** The five read-only investigation tools (chat reuses these, minus writes/control). */
export const READONLY_TOOL_NAMES: readonly AgentToolName[] = [
  'search_logs',
  'get_metrics',
  'get_recent_deploys',
  'get_deploy_diff',
  'read_file',
];

/** The single write tool (SPEC §9 — the only mutating tool). */
export const WRITE_TOOL_NAME: AgentToolName = 'create_fix_pr';

/** Dynamic dispatch by tool name (used by the SDK loop + tests). */
export async function runTool(
  ctx: ToolContext,
  name: AgentToolName,
  rawInput: unknown,
): Promise<unknown> {
  const d = TOOL_BY_NAME[name];
  if (!d) throw new Error(`unknown tool: ${name}`);
  return d.handler(ctx, rawInput);
}

/* Fail fast at module load if the registry drifts from the canonical allowlist. */
{
  const registered = TOOL_DEFINITIONS.map((d) => d.name).sort();
  const canonical = [...AGENT_TOOL_NAMES].sort();
  if (registered.length !== canonical.length || registered.some((n, i) => n !== canonical[i])) {
    throw new Error(
      `tool registry drift: [${registered.join(', ')}] != allowlist [${canonical.join(', ')}]`,
    );
  }
}
