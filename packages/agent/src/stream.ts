import type { StepType } from '@oncall/shared';
import { MCP_SERVER_NAME } from './mcp.js';

/**
 * SDK message → investigation-step mapper (SPEC §9 `stream.ts`, NFR-06).
 *
 * The engine iterates `query()`'s async generator; this module maps each SDK
 * message to zero or more persisted `investigation_step`s (which the engine then
 * writes + streams to the `StepSink`):
 *   assistant text     → `thought`
 *   assistant tool_use → `tool_call`   (tool_name + tool_input)
 *   user tool_result   → `tool_result` (tool_name via tool_use_id correlation + output)
 *
 * It is deliberately tolerant of the SDK's large message union — only the few
 * fields it reads are typed structurally, so the same mapper works against the
 * real SDK and the deterministic fake used in tests.
 */

/* ── structural views of the SDK messages we consume ──────────────────────── */

export interface SdkTextBlock {
  type: 'text';
  text: string;
}
export interface SdkToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: unknown;
}
export interface SdkToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: unknown;
  is_error?: boolean;
}
export type SdkContentBlock =
  | SdkTextBlock
  | SdkToolUseBlock
  | SdkToolResultBlock
  | { type: string; [k: string]: unknown };

export interface SdkAssistantMessage {
  type: 'assistant';
  message: { content: SdkContentBlock[] | string };
  error?: unknown;
}
export interface SdkUserMessage {
  type: 'user';
  message: { content: SdkContentBlock[] | string };
}
export interface SdkResultMessage {
  type: 'result';
  subtype: string;
  is_error?: boolean;
  result?: string;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  errors?: string[];
}
export interface SdkSystemMessage {
  type: 'system';
  subtype?: string;
  [k: string]: unknown;
}
export type EngineSdkMessage =
  | SdkAssistantMessage
  | SdkUserMessage
  | SdkResultMessage
  | SdkSystemMessage
  | { type: string; [k: string]: unknown };

/* ── mapped step (pre-persistence) ────────────────────────────────────────── */

export interface MappedStep {
  type: StepType;
  tool_name?: string | null;
  tool_input?: unknown;
  tool_output?: unknown;
  content?: string | null;
}

/** Strip the `mcp__oncall__` prefix so persisted `tool_name` is the bare tool name. */
export function stripMcpPrefix(name: string): string {
  const prefix = `mcp__${MCP_SERVER_NAME}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/** True when a tool_result payload is a `create_fix_pr` refusal (`{escalate:true}`). */
export function isRefusalOutput(output: unknown): boolean {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as { escalate?: unknown }).escalate === true
  );
}

/** Extract the text payload out of an SDK/MCP tool_result `content` field. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === 'object' && (b as { type?: string }).type === 'text'
          ? String((b as { text?: unknown }).text ?? '')
          : '',
      )
      .join('');
  }
  return '';
}

/** Best-effort JSON parse; returns the raw text when it is not JSON. */
function parseToolOutput(content: unknown): unknown {
  const text = toolResultText(content);
  if (text === '') return content ?? null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function blocksOf(content: SdkContentBlock[] | string): SdkContentBlock[] {
  if (typeof content === 'string') {
    return content.trim() === '' ? [] : [{ type: 'text', text: content }];
  }
  return Array.isArray(content) ? content : [];
}

/**
 * Stateful mapper — one per investigation. Correlates `tool_use` ids to names so
 * a later `tool_result` can be labelled with the tool that produced it, and
 * remembers whether `create_fix_pr` refused (FR-13) for the engine's decision.
 */
export class InvestigationStreamMapper {
  private readonly toolNameById = new Map<string, string>();
  /** Set when a `create_fix_pr` tool_result was a refusal (`{escalate:true}`). */
  createFixPrRefused = false;
  /** Set when a `create_fix_pr` tool_result was a success (carries a `pr_number`). */
  createFixPrSucceeded = false;
  /** The root_cause / confidence the agent passed to a successful `create_fix_pr`. */
  proposedFix?: { root_cause?: string; confidence?: number };
  /** Pending create_fix_pr input awaiting its tool_result outcome. */
  private pendingFixInput?: { root_cause?: string; confidence?: number };

  /** Map one SDK message to the steps it produces (in emit order). */
  map(message: EngineSdkMessage): MappedStep[] {
    const type = (message as { type?: string }).type;
    if (type === 'assistant') return this.mapAssistant(message as SdkAssistantMessage);
    if (type === 'user') return this.mapUser(message as SdkUserMessage);
    return [];
  }

  private mapAssistant(message: SdkAssistantMessage): MappedStep[] {
    const steps: MappedStep[] = [];
    for (const block of blocksOf(message.message?.content ?? [])) {
      if (block.type === 'text') {
        const text = String((block as SdkTextBlock).text ?? '').trim();
        if (text !== '') steps.push({ type: 'thought', content: text });
      } else if (block.type === 'tool_use') {
        const tu = block as SdkToolUseBlock;
        const name = stripMcpPrefix(tu.name);
        if (tu.id) this.toolNameById.set(tu.id, name);
        if (name === 'submit_findings') {
          // The terminal control tool → a `conclusion` step (SPEC §9). Its findings
          // live in the tool_use INPUT; the {acknowledged:true} result is skipped.
          const input = (tu.input ?? {}) as { root_cause?: unknown };
          steps.push({
            type: 'conclusion',
            tool_name: name,
            tool_input: tu.input ?? null,
            content:
              typeof input.root_cause === 'string' ? input.root_cause : undefined,
          });
        } else {
          if (name === 'create_fix_pr') {
            const input = (tu.input ?? {}) as { root_cause?: unknown; confidence?: unknown };
            this.pendingFixInput = {
              root_cause: typeof input.root_cause === 'string' ? input.root_cause : undefined,
              confidence: typeof input.confidence === 'number' ? input.confidence : undefined,
            };
          }
          steps.push({ type: 'tool_call', tool_name: name, tool_input: tu.input ?? null });
        }
      }
    }
    return steps;
  }

  private mapUser(message: SdkUserMessage): MappedStep[] {
    const steps: MappedStep[] = [];
    for (const block of blocksOf(message.message?.content ?? [])) {
      if (block.type !== 'tool_result') continue;
      const tr = block as SdkToolResultBlock;
      const name = tr.tool_use_id ? this.toolNameById.get(tr.tool_use_id) ?? null : null;
      // The submit_findings ack carries no signal — its conclusion step was already
      // emitted from the tool_use; skip the redundant tool_result.
      if (name === 'submit_findings') continue;
      const output = parseToolOutput(tr.content);
      if (name === 'create_fix_pr') {
        if (isRefusalOutput(output)) {
          this.createFixPrRefused = true;
        } else if (
          typeof output === 'object' &&
          output !== null &&
          typeof (output as { pr_number?: unknown }).pr_number === 'number'
        ) {
          this.createFixPrSucceeded = true;
          this.proposedFix = this.pendingFixInput;
        }
      }
      steps.push({ type: 'tool_result', tool_name: name, tool_output: output });
    }
    return steps;
  }
}

/** Usage/cost extracted from the terminal `result` message. */
export interface ResultUsage {
  status: 'success' | 'max_turns' | 'max_budget' | 'error';
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  numTurns: number;
  errorMessage?: string;
}

/** Read token usage + cost + terminal reason from a `result` SDK message. */
export function readResultUsage(message: SdkResultMessage): ResultUsage {
  const usage = message.usage ?? {};
  const sub = message.subtype ?? '';
  let status: ResultUsage['status'] = 'success';
  if (sub === 'success') status = 'success';
  else if (sub === 'error_max_turns') status = 'max_turns';
  else if (sub === 'error_max_budget_usd') status = 'max_budget';
  else status = 'error';
  return {
    status,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    costUsd: message.total_cost_usd ?? 0,
    numTurns: message.num_turns ?? 0,
    errorMessage:
      status !== 'success'
        ? (message.errors && message.errors.join('; ')) || message.result || sub
        : undefined,
  };
}
