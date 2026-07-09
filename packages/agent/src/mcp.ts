import { z } from 'zod';
import { AGENT_TOOL_NAMES, type AgentToolName } from '@oncall/shared';
import type { ToolContext } from './ports.js';
import { runTool } from './tools/index.js';

/**
 * In-process MCP wiring (SPEC §9) — exposes the six C6 tools + `submit_findings`
 * as Claude Agent SDK tools via `createSdkMcpServer()` / `tool()`.
 *
 * The SDK, MCP server, and `tool()` are imported **lazily** (dynamic import) so
 * the deterministic unit tests — which inject a fake `query` and a fake MCP
 * factory — never load the real Agent SDK / spawn a subprocess. Only the live
 * path (or the live-investigate script) touches `@anthropic-ai/claude-agent-sdk`.
 *
 * Every tool handler delegates to the C6 registry's `runTool(ctx, name, input)`,
 * which validates the input against the canonical `@oncall/shared` zod schema and
 * returns the already-bounded output. Secrets never enter tool inputs/outputs or
 * the prompt (NFR-02); the token lives only inside the pinned `ctx.octokit`.
 */

/** The MCP server name — tool ids become `mcp__oncall__<tool>` (SDK convention). */
export const MCP_SERVER_NAME = 'oncall';

/** Map a bare tool name to its SDK-prefixed allowlist id. */
export function mcpToolName(name: string): string {
  return `mcp__${MCP_SERVER_NAME}__${name}`;
}

/** The exact allowlist passed to `allowedTools` — the 7 tools, nothing else (SPEC §9). */
export const MCP_ALLOWED_TOOL_NAMES: string[] = AGENT_TOOL_NAMES.map(mcpToolName);

/**
 * Model-facing input shapes (raw zod shapes, per the SDK `tool()` contract). These
 * describe parameters to the model; the authoritative validation (incl. the
 * `create_fix_pr` refinements and the `get_deploy_diff` union) happens inside
 * `runTool` against `@oncall/shared`. Kept intentionally close to those schemas.
 */
const TOOL_INPUT_SHAPES: Record<AgentToolName, z.ZodRawShape> = {
  search_logs: {
    service: z.string().optional().describe('service name to filter by'),
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    query: z.string().optional().describe('substring to match in the message'),
    endpoint: z.string().optional(),
    status: z.number().int().optional().describe('HTTP status to filter by'),
    since: z.number().int().optional().describe('epoch ms lower bound'),
    until: z.number().int().optional().describe('epoch ms upper bound'),
    limit: z.number().int().min(1).max(50).default(30),
  },
  get_metrics: {
    service: z.string().describe('service to fetch metrics for'),
    window_sec: z.number().int().min(1).max(3600).default(900),
    resolution_sec: z.number().int().min(1).default(15),
  },
  get_recent_deploys: {
    limit: z.number().int().min(1).max(20).default(10),
  },
  get_deploy_diff: {
    sha: z.string().optional().describe('a single commit sha (diffed against its parent)'),
    base: z.string().optional().describe('base ref for a range diff (use with head)'),
    head: z.string().optional().describe('head ref for a range diff (use with base)'),
  },
  read_file: {
    path: z.string().describe('repo-relative path (no .. or absolute paths)'),
    ref: z.string().optional().describe('git ref; defaults to the default branch'),
    start_line: z.number().int().min(1).optional(),
    end_line: z.number().int().min(1).optional(),
  },
  create_fix_pr: {
    kind: z.enum(['revert', 'patch']),
    confidence: z.number().min(0).max(1).describe('your true confidence in the fix (0–1)'),
    root_cause: z.string(),
    title: z.string(),
    body: z.string().describe('full diagnostic report — becomes the PR description'),
    revert_sha: z.string().optional().describe('required when kind="revert"'),
    files: z
      .array(z.object({ path: z.string(), content: z.string() }))
      .optional()
      .describe('required when kind="patch"'),
  },
  submit_findings: {
    root_cause: z.string(),
    evidence: z.array(
      z.object({ type: z.string(), tool: z.string().optional(), ref: z.string() }),
    ),
    confidence: z.number().min(0).max(1),
    decision: z.enum(['propose_fix', 'escalate']),
  },
};

/** Read-only tools (annotation hint) vs the single write tool. */
const READ_ONLY: Record<AgentToolName, boolean> = {
  search_logs: true,
  get_metrics: true,
  get_recent_deploys: true,
  get_deploy_diff: true,
  read_file: true,
  create_fix_pr: false,
  submit_findings: true,
};

/** Descriptions shown to the model for each tool (kept short; the system prompt has the workflow). */
const TOOL_DESCRIPTIONS: Record<AgentToolName, string> = {
  search_logs: 'Read recent log events for a service, with repetitive errors summarized by signature.',
  get_metrics: 'Read a service’s current error-rate and latency percentiles vs its baseline.',
  get_recent_deploys: 'List recent commits (deploys) on the pinned repo; is_current marks the live one.',
  get_deploy_diff: 'Show the code change a deploy introduced — pass {sha} or {base, head}.',
  read_file: 'Read a source file from the pinned repo (repo-relative path only).',
  create_fix_pr:
    'Open ONE real pull request that fixes the incident. kind:"revert" (preferred, needs revert_sha) or kind:"patch" (needs files[]). Refuses + escalates below the confidence threshold. The only write tool — it can never merge or write a protected branch.',
  submit_findings:
    'End the investigation with a structured conclusion (root_cause, evidence[], confidence, decision). Call exactly once, last.',
};

/** What a built MCP wiring returns to the engine. */
export interface McpWiring {
  /** The `createSdkMcpServer()` instance to register under `mcpServers.oncall`. */
  server: unknown;
  /** The prefixed tool ids for `allowedTools` (exactly these — SPEC §9 sandbox). */
  toolNames: string[];
}

/**
 * Build the real Agent-SDK MCP server that fronts the C6 tools for `ctx`.
 * Lazily imports the SDK so non-live code paths stay SDK-free. Each tool handler
 * runs the canonical C6 tool and returns its bounded JSON output as a text block.
 */
export async function createInvestigationMcpServer(ctx: ToolContext): Promise<McpWiring> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const { tool, createSdkMcpServer } = sdk;

  const tools = AGENT_TOOL_NAMES.map((name) =>
    tool(
      name,
      TOOL_DESCRIPTIONS[name],
      TOOL_INPUT_SHAPES[name],
      async (args: unknown) => {
        try {
          const output = await runTool(ctx, name, args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(output) }],
            structuredContent: (output ?? {}) as Record<string, unknown>,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify({ error: message }) },
            ],
            isError: true,
          };
        }
      },
      // alwaysLoad → the 7 tools are present from turn 1, so the SDK never defers
      // them behind a `ToolSearch` round-trip (which would waste an iteration and
      // widen the callable-tool surface). This keeps the sandbox exactly the 7.
      { alwaysLoad: true, annotations: { readOnlyHint: READ_ONLY[name] } },
    ),
  );

  const server = createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: '0.1.0',
    tools,
  });

  return { server, toolNames: MCP_ALLOWED_TOOL_NAMES };
}
