import type { Incident, SessionResult, SessionStatus, Step } from '@oncall/shared';
import type {
  PrCreatedData,
  ConclusionData,
} from '@oncall/shared';
import type { StepSink, ToolContext } from './ports.js';
import type {
  AgentEngineConfig,
  EngineSessionsDao,
  EngineStepsDao,
  InvestigationEngine,
  LiveEngineDeps,
  McpFactory,
  SdkQueryFn,
} from './engine.js';
import { createInvestigationMcpServer } from './mcp.js';
import { AGENT_SYSTEM_PROMPT, buildIncidentPrompt } from './prompts.js';
import {
  InvestigationStreamMapper,
  readResultUsage,
  type EngineSdkMessage,
  type MappedStep,
  type SdkResultMessage,
} from './stream.js';

/**
 * `LiveClaudeEngine` (SPEC §9) — the real agentic loop over the Claude Agent SDK
 * `query()` using the developer's Claude Max subscription (no API key). The six
 * C6 tools + `submit_findings` are registered as in-process MCP tools; the loop
 * is locked to exactly those (`allowedTools` + `permissionMode:'dontAsk'` +
 * `settingSources:[]`) so no built-in shell/fs/web tool is reachable.
 *
 * Each SDK message is mapped to a persisted `investigation_step` + a `StepSink`
 * emit (NFR-06). Termination is driven by `submit_findings` (writes the session
 * conclusion, FR-08), the `AGENT_MAX_ITERATIONS` cap, the cost cap, or an SDK
 * error. The FR-13 escalation path fires when the agent decides `escalate` or
 * when `create_fix_pr` refuses a low-confidence fix.
 */

/**
 * Built-in tools explicitly denied as defense-in-depth (the allowlist already
 * excludes them). `ToolSearch` is included so the harness cannot defer our tools
 * behind a discovery round-trip — with `alwaysLoad:true` on every custom tool the
 * seven are present from turn 1, so discovery is never needed.
 */
const BUILTIN_DENYLIST: string[] = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Task',
  'TodoWrite',
  'ToolSearch',
];

/** Runaway-generator guard (message ceiling), sized well above the SDK's turn cap. */
const RUNAWAY_MSG_FACTOR = 8;
const RUNAWAY_MSG_BASE = 16;

/** Default real SDK `query` wrapper — lazily imported so non-live paths stay SDK-free. */
async function* defaultQueryFn(args: {
  prompt: string;
  options: Record<string, unknown>;
  ctx: ToolContext;
}): AsyncIterable<EngineSdkMessage> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const stream = sdk.query({
    prompt: args.prompt,
    // The SDK Options type is a large superset; we build a validated subset.
    options: args.options as unknown as Parameters<typeof sdk.query>[0]['options'],
  });
  for await (const message of stream) {
    yield message as unknown as EngineSdkMessage;
  }
}

export class LiveClaudeEngine implements InvestigationEngine {
  private readonly db: LiveEngineDeps['db'];
  private readonly octokit: LiveEngineDeps['octokit'];
  private readonly config: AgentEngineConfig;
  private readonly sessions: EngineSessionsDao;
  private readonly steps: EngineStepsDao;
  private readonly queryFn: SdkQueryFn;
  private readonly mcpFactory: McpFactory;
  private readonly usingRealSdk: boolean;
  private readonly now: () => number;

  constructor(deps: LiveEngineDeps) {
    this.db = deps.db;
    this.octokit = deps.octokit;
    this.config = deps.config;
    this.sessions = deps.sessions;
    this.steps = deps.steps;
    this.usingRealSdk = !deps.queryFn;
    this.queryFn = deps.queryFn ?? defaultQueryFn;
    this.mcpFactory = deps.mcpFactory ?? createInvestigationMcpServer;
    this.now = deps.now ?? (() => Date.now());
  }

  async investigate(incident: Incident, userSink: StepSink): Promise<SessionResult> {
    const { model, maxIterations, costCapUsd } = this.config.agent;
    const session = this.sessions.create({
      incident_id: incident.id,
      mode: 'live',
      model,
      started_at: this.now(),
    });

    // Capture the outcomes the tools surface via the sink (prCreated / conclusion).
    const capture: { pr?: PrCreatedData; conclusion?: ConclusionData } = {};
    const wrappedSink: StepSink = {
      step: (s) => userSink.step?.(s),
      prCreated: (d) => {
        capture.pr = d;
        return userSink.prCreated?.(d);
      },
      conclusion: (d) => {
        capture.conclusion = d;
        return userSink.conclusion?.(d);
      },
    };

    const ctx: ToolContext = {
      db: this.db,
      octokit: this.octokit,
      config: this.config,
      customer: { id: incident.customer_id },
      incident,
      sink: wrappedSink,
    };

    // Persist + stream one mapped step.
    const emit = async (mapped: MappedStep): Promise<void> => {
      const created_at = this.now();
      const appended = this.steps.append({
        session_id: session.id,
        type: mapped.type,
        tool_name: mapped.tool_name ?? null,
        tool_input: mapped.tool_input ?? null,
        tool_output: mapped.tool_output ?? null,
        content: mapped.content ?? null,
        created_at,
      });
      const step: Step = {
        session_id: session.id,
        seq: appended.seq,
        type: mapped.type,
        tool_name: mapped.tool_name ?? null,
        tool_input: mapped.tool_input ?? null,
        tool_output: mapped.tool_output ?? null,
        content: mapped.content ?? null,
        created_at,
        ts: created_at,
      };
      await userSink.step?.(step);
    };

    if (this.usingRealSdk) this.ensureSubscriptionEnv();

    const mapper = new InvestigationStreamMapper();
    // The SDK's own `maxTurns` is the primary iteration cap (it counts model
    // turns and emits `error_max_turns`). Because the SDK can emit several
    // assistant messages per model turn, we only count assistant messages as a
    // *fallback* iteration figure and guard against a runaway generator with a
    // generous message ceiling — never pre-empting the SDK's real turn cap.
    const runawayCap = maxIterations * RUNAWAY_MSG_FACTOR + RUNAWAY_MSG_BASE;
    let assistantMessages = 0;
    let reportedTurns: number | null = null;
    let messagesSeen = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let overflow: 'max_turns' | 'max_budget' | null = null;
    let sdkError: string | undefined;
    let lastThought: string | undefined;

    try {
      const wiring = await this.mcpFactory(ctx);
      const options: Record<string, unknown> = {
        model,
        maxTurns: maxIterations,
        systemPrompt: AGENT_SYSTEM_PROMPT,
        mcpServers: { oncall: wiring.server },
        allowedTools: wiring.toolNames,
        disallowedTools: BUILTIN_DENYLIST,
        permissionMode: 'dontAsk',
        settingSources: [],
        includePartialMessages: false,
      };

      const stream = this.queryFn({
        prompt: buildIncidentPrompt(incident),
        options,
        ctx,
      });

      for await (const message of stream) {
        messagesSeen += 1;
        const type = (message as { type?: string }).type;

        if (type === 'assistant') {
          assistantMessages += 1;
          if ((message as { error?: unknown }).error) {
            sdkError = 'assistant message reported an error';
          }
          for (const mapped of mapper.map(message)) {
            if (mapped.type === 'thought' && mapped.content) lastThought = mapped.content;
            await emit(mapped);
          }
        } else if (type === 'user') {
          for (const mapped of mapper.map(message)) {
            await emit(mapped);
          }
        } else if (type === 'result') {
          const usage = readResultUsage(message as SdkResultMessage);
          inputTokens = usage.inputTokens;
          outputTokens = usage.outputTokens;
          costUsd = usage.costUsd;
          reportedTurns = usage.numTurns || null;
          if (usage.status === 'max_turns') overflow = 'max_turns';
          else if (usage.status === 'max_budget') overflow = 'max_budget';
          else if (usage.status === 'error') sdkError = usage.errorMessage ?? 'SDK error';
          break; // the result frame is terminal — the SDK is done.
        }

        // Terminal: the agent called submit_findings.
        if (capture.conclusion) break;
        // Cost backstop (NFR-07) — ~$0 under subscription, but still bounds runaway.
        if (costUsd > costCapUsd) {
          overflow = overflow ?? 'max_budget';
          break;
        }
        // Runaway guard (latency, NFR-05) — only if the SDK never terminates.
        if (messagesSeen >= runawayCap) {
          overflow = overflow ?? 'max_turns';
          break;
        }
      }
    } catch (err) {
      sdkError = err instanceof Error ? err.message : String(err);
      await emit({ type: 'error', content: `Investigation failed: ${sdkError}` });
    }

    // Prefer the SDK's authoritative model-turn count; fall back to assistant messages.
    const iterations = reportedTurns ?? assistantMessages;

    return this.finalize({
      session,
      incident,
      model,
      capture,
      refused: mapper.createFixPrRefused,
      proposedFix: mapper.proposedFix,
      iterations,
      inputTokens,
      outputTokens,
      costUsd,
      overflow,
      sdkError,
      lastThought,
    });
  }

  /** Resolve the terminal session state, persist it, and escalate the incident if needed. */
  private finalize(args: {
    session: { id: string };
    incident: Incident;
    model: string;
    capture: { pr?: PrCreatedData; conclusion?: ConclusionData };
    refused: boolean;
    proposedFix?: { root_cause?: string; confidence?: number };
    iterations: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    overflow: 'max_turns' | 'max_budget' | null;
    sdkError?: string;
    lastThought?: string;
  }): SessionResult {
    const { session, incident, model, capture, refused } = args;
    const conclusion = capture.conclusion;
    const pr = capture.pr;
    // A real PR was opened (and not via a refused low-confidence call) → a fix is proposed.
    const fixProposed = !!pr && !refused;

    let status: SessionStatus;
    let decision: 'propose_fix' | 'escalate' | null;
    let rootCause: string | null;
    let confidence: number | null;

    if (conclusion) {
      rootCause = conclusion.root_cause;
      confidence = conclusion.confidence;
      if (conclusion.decision === 'propose_fix' && fixProposed) {
        // Happy path: a real PR was opened and the agent proposes it.
        status = 'completed';
        decision = 'propose_fix';
      } else {
        // Escalate: the agent chose escalate, was refused, or proposed a fix
        // without actually opening a PR.
        status = 'escalated';
        decision = 'escalate';
        this.escalateIncident(incident, rootCause, confidence);
      }
    } else if (fixProposed) {
      // Stopped (iteration/cost cap or a silent stop) AFTER opening a real PR but
      // before submit_findings — the fix still stands. Keep the incident's
      // create_fix_pr-set `fix_proposed` status; do NOT downgrade it to escalated.
      status = 'completed';
      decision = 'propose_fix';
      rootCause = args.proposedFix?.root_cause ?? args.lastThought ?? 'Fix proposed via pull request.';
      confidence = args.proposedFix?.confidence ?? null;
    } else {
      // No submit_findings and no PR — force escalate with partial findings (SPEC §9 overflow).
      rootCause =
        args.lastThought ??
        (args.sdkError
          ? `Investigation ended without a conclusion: ${args.sdkError}`
          : 'Investigation ended without a conclusion.');
      confidence = null;
      decision = 'escalate';
      status = args.sdkError ? 'failed' : 'escalated';
      this.escalateIncident(incident, rootCause, confidence);
    }

    const summary = this.buildSummary({
      status,
      decision,
      pr,
      refused,
      overflow: args.overflow,
      sdkError: args.sdkError,
    });

    this.sessions.finish(session.id, {
      status,
      root_cause: rootCause,
      confidence,
      decision,
      summary,
      iterations: args.iterations,
      input_tokens: args.inputTokens,
      output_tokens: args.outputTokens,
      cost_usd: args.costUsd,
      completed_at: this.now(),
    });

    return {
      session_id: session.id,
      status,
      mode: 'live',
      model,
      iterations: args.iterations,
      root_cause: rootCause,
      confidence,
      decision,
      cost_usd: args.costUsd,
      pr_number: pr?.number ?? null,
      pr_url: pr?.url ?? null,
    };
  }

  /** Mark the incident escalated (no PR path). Never downgrades a fix_proposed incident. */
  private escalateIncident(
    incident: Incident,
    rootCause: string | null,
    confidence: number | null,
  ): void {
    try {
      this.db.dao.incidents.update(incident.id, {
        status: 'escalated',
        root_cause: rootCause,
        confidence,
      });
    } catch {
      // Persistence is best-effort here; the session row already records the outcome.
    }
  }

  private buildSummary(args: {
    status: SessionStatus;
    decision: 'propose_fix' | 'escalate' | null;
    pr?: PrCreatedData;
    refused: boolean;
    overflow: 'max_turns' | 'max_budget' | null;
    sdkError?: string;
  }): string {
    if (args.status === 'completed' && args.pr) {
      return `Proposed a ${args.pr.kind} fix as PR #${args.pr.number}.`;
    }
    if (args.sdkError) return `Escalated after an SDK error: ${args.sdkError}`;
    if (args.refused) return 'Escalated: create_fix_pr refused a low-confidence fix (FR-13).';
    if (args.overflow === 'max_turns') {
      return 'Escalated: reached the iteration cap without a proposed fix.';
    }
    if (args.overflow === 'max_budget') {
      return 'Escalated: reached the cost cap without a proposed fix.';
    }
    return 'Escalated: the agent decided a human should take over.';
  }

  /** Best-effort: make the spawned Agent SDK subprocess use the Claude subscription. */
  private ensureSubscriptionEnv(): void {
    if (this.config.agent.useClaudeSubscription === false) return;
    process.env.USE_CLAUDE_SUBSCRIPTION = 'true';
    process.env.CLAUDE_CODE_USE_SUBSCRIPTION = 'true';
    const key = this.config.agent.anthropicApiKey;
    if (!key || key.trim() === '') {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }
}
