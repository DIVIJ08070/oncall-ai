import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  Confidence,
  Decision,
  Incident,
  SessionMode,
  SessionResult,
  SessionStatus,
  StepType,
} from '@oncall/shared';
import type { PinnedGitHub, StepSink, ToolConfig, ToolContext, ToolDb } from './ports.js';
import type { EngineSdkMessage } from './stream.js';
import { LiveClaudeEngine } from './live.js';

/**
 * Investigation engine interface + factory (SPEC §9 `engine.ts`, §13).
 *
 * `LiveClaudeEngine` (live.ts, Claude Agent SDK) and `CachedEngine` (C8) both
 * implement `InvestigationEngine` and write identical `investigation_sessions` /
 * `investigation_steps` + emit identical `StepSink` events, so the server + the
 * dashboard are agnostic to which one ran.
 */
export interface InvestigationEngine {
  /** Run an investigation for `incident`, streaming steps to `sink`; resolves with a summary. */
  investigate(incident: Incident, sink: StepSink): Promise<SessionResult>;
}

/* ── persistence ports (structurally satisfied by the server DAOs) ─────────── */

/** The `investigation_sessions` writes the engine performs (server `InvestigationSessionsDao`). */
export interface EngineSessionsDao {
  create(input: {
    incident_id: string;
    mode: SessionMode;
    model: string;
    started_at?: number;
  }): { id: string };
  finish(
    id: string,
    fields: {
      status: SessionStatus;
      root_cause?: string | null;
      confidence?: Confidence | null;
      decision?: Decision | null;
      summary?: string | null;
      iterations?: number;
      input_tokens?: number;
      output_tokens?: number;
      cost_usd?: number;
      completed_at?: number;
    },
  ): unknown;
}

/** The `investigation_steps` append the engine performs (server `InvestigationStepsDao`). */
export interface EngineStepsDao {
  append(input: {
    session_id: string;
    type: StepType;
    tool_name?: string | null;
    tool_input?: unknown;
    tool_output?: unknown;
    content?: string | null;
    created_at?: number;
  }): { seq: number };
}

/* ── config (structurally satisfied by the server `Config`) ────────────────── */

/** The agent knobs the engine reads (SPEC §14). A server `Config` satisfies this. */
export interface AgentEngineConfig extends ToolConfig {
  agent: {
    /** FR-13 escalation gate for `create_fix_pr`. */
    confidenceThreshold: number;
    /** SDK `model` option (§14 AGENT_MODEL). */
    model: string;
    /** SDK `maxTurns` / loop cap (§14 AGENT_MAX_ITERATIONS). */
    maxIterations: number;
    /** Latency/turn bound; ~$0 under subscription but still bounds turns (§14). */
    costCapUsd: number;
    /** Factory selection (§14 AGENT_MODE). */
    mode?: 'auto' | 'live' | 'cached';
    /** Subscription auth toggle (§14 USE_CLAUDE_SUBSCRIPTION). */
    useClaudeSubscription?: boolean;
    /** Present only for compatibility; empty under subscription (§14). */
    anthropicApiKey?: string;
    /** §13/§14 CACHE_REAL_PR — cached replay still opens a real PR (default true). */
    cacheRealPr?: boolean;
  };
}

/* ── SDK boundary (injectable for deterministic tests) ─────────────────────── */

/**
 * The `query()` function the live engine consumes. The real default wraps
 * `@anthropic-ai/claude-agent-sdk`'s `query`; tests inject a fake async generator.
 * `ctx` is passed through so a fake can execute the tools (the real SDK runs them
 * itself via the in-process MCP server and ignores this field).
 */
export type SdkQueryFn = (args: {
  prompt: string;
  options: Record<string, unknown>;
  ctx: ToolContext;
}) => AsyncIterable<EngineSdkMessage>;

/** Builds the MCP wiring for a run; injectable so tests stay SDK-free. */
export type McpFactory = (
  ctx: ToolContext,
) => Promise<{ server: unknown; toolNames: string[] }> | { server: unknown; toolNames: string[] };

/* ── live engine deps ──────────────────────────────────────────────────────── */

export interface LiveEngineDeps {
  db: ToolDb;
  /** Repo-pinned GitHub facade (server builds it from Octokit + config.github). */
  octokit: PinnedGitHub;
  config: AgentEngineConfig;
  sessions: EngineSessionsDao;
  steps: EngineStepsDao;
  /** Injected in tests; defaults to the real Agent SDK `query`. */
  queryFn?: SdkQueryFn;
  /** Injected in tests; defaults to the real in-process MCP server builder. */
  mcpFactory?: McpFactory;
  /** Clock injection (tests). */
  now?: () => number;
}

/* ── factory (SPEC §9 — live | cached | auto behind one interface) ─────────── */

export interface EngineFactoryDeps extends LiveEngineDeps {
  /**
   * C8 supplies this so `AGENT_MODE=cached` (or `auto` fallback) returns a
   * `CachedEngine`. Until C8 lands it is absent; `cached`/unavailable-`auto`
   * then throws a clear error rather than silently degrading.
   */
  cachedEngineFactory?: (deps: LiveEngineDeps) => InvestigationEngine;
  /** Override the live-availability probe (tests). */
  isLiveAvailable?: () => boolean;
}

/**
 * Best-effort check for whether the live Agent SDK / subscription is usable in
 * this process. The definitive test is a real `query()`, but `auto` uses this to
 * avoid spawning the SDK when it plainly cannot authenticate.
 */
export function isLiveEngineAvailable(config: AgentEngineConfig): boolean {
  const agent = config.agent;
  // A configured API key is always sufficient.
  if (agent.anthropicApiKey && agent.anthropicApiKey.trim() !== '') return true;
  // Otherwise require subscription auth to be enabled AND a logged-in session file.
  if (agent.useClaudeSubscription === false) return false;
  try {
    return existsSync(join(homedir(), '.claude.json'));
  } catch {
    return false;
  }
}

/**
 * Select an `InvestigationEngine` per `AGENT_MODE` + availability (SPEC §9/§13):
 *   - `live`   → always the Claude Agent SDK engine.
 *   - `cached` → the C8 cached engine (throws until `cachedEngineFactory` is wired).
 *   - `auto`   → live when the SDK/subscription looks reachable, else cached (if wired).
 */
export function createEngine(deps: EngineFactoryDeps): InvestigationEngine {
  const mode = deps.config.agent.mode ?? 'auto';
  const {
    cachedEngineFactory,
    isLiveAvailable = () => isLiveEngineAvailable(deps.config),
    ...liveDeps
  } = deps;

  const makeLive = (): InvestigationEngine => new LiveClaudeEngine(liveDeps);
  const makeCached = (): InvestigationEngine => {
    if (!cachedEngineFactory) {
      throw new Error(
        'CachedEngine is not available (C8 not wired). Set AGENT_MODE=live or provide cachedEngineFactory.',
      );
    }
    return cachedEngineFactory(liveDeps);
  };

  if (mode === 'live') return makeLive();
  if (mode === 'cached') return makeCached();
  // auto
  if (isLiveAvailable()) return makeLive();
  if (cachedEngineFactory) return makeCached();
  return makeLive();
}
