import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CreateFixPrInput,
  CreateFixPrOutput,
  CreateFixPrSuccess,
  Decision,
  Incident,
  SessionResult,
  SessionStatus,
  Step,
  StepType,
} from '@oncall/shared';
import type { ConclusionData, PrCreatedData } from '@oncall/shared';
import type { StepSink, ToolContext } from './ports.js';
import type {
  AgentEngineConfig,
  EngineSessionsDao,
  EngineStepsDao,
  InvestigationEngine,
  LiveEngineDeps,
} from './engine.js';
import { runTool } from './tools/index.js';

/**
 * `CachedEngine` (SPEC §13, NFR-09) — deterministic replay behind the same
 * `InvestigationEngine` interface as `LiveClaudeEngine`. Selected by the factory
 * when `AGENT_MODE=cached`, or by `auto` when the Claude subscription / Agent SDK
 * is unreachable (offline demo).
 *
 * It replays a **recorded scenario** (`cache/<scenario>.json`, captured by
 * `scripts/record-cache.ts` running the LIVE engine once per scenario) to the
 * SAME `StepSink` with small (~400–800 ms) delays, so the live investigation feed
 * looks identical to a real run (NFR-06 parity). The scenario is chosen from the
 * incident's fingerprint → scenario map, falling back to detector / suspect-SHA /
 * keyword heuristics, then to the demo's primary (`bad_deploy`).
 *
 * **Real-PR fallback (§13):** at the `create_fix_pr` step the cached engine
 * EXECUTES the real tool by default (`CACHE_REAL_PR=true`) so a genuine PR is
 * still opened even with the LLM offline; if Octokit also fails it falls back to a
 * canned PR record (the PR captured at record time) so the demo continues.
 */

/* ── scenario catalogue ────────────────────────────────────────────────────── */

/** The three seeded failure scenarios (SPEC §12; == the victim's failure modes). */
export const SCENARIO_NAMES = ['bad_deploy', 'slow_db', 'config_error'] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

/** The demo's primary scenario — the resolver's last-resort default. */
export const PRIMARY_SCENARIO: ScenarioName = 'bad_deploy';

/* ── recorded cache file format ────────────────────────────────────────────── */

/** One recorded step (a subset of a persisted `investigation_step`). */
export interface CachedStep {
  type: StepType;
  tool_name?: string | null;
  tool_input?: unknown;
  tool_output?: unknown;
  content?: string | null;
}

/** Heuristic selectors so an incident routes to the right scenario without an exact fingerprint. */
export interface CachedScenarioMatch {
  /** `error_rate` | `latency` | `silence`. */
  detector?: string;
  /** The scenario's seeded bad-deploy SHA (matched against `incident.suspect_deploy_sha`). */
  suspect_deploy_sha?: string;
  /** Substrings that identify this scenario in the incident title / root cause. */
  keywords?: string[];
}

/** The terminal outcome captured at record time (mirrors `SessionResult` minus the PR). */
export interface CachedOutcome {
  status: SessionStatus;
  decision: Decision | null;
  root_cause: string | null;
  confidence: number | null;
  iterations: number;
  cost_usd: number;
}

/** A recorded scenario replayed by the cached engine. */
export interface CachedScenario {
  scenario: ScenarioName;
  recorded_at: number;
  model: string;
  /** Incident fingerprints this scenario was recorded for (fingerprint → scenario map, §13). */
  fingerprints: string[];
  /** Robust fallback selectors when the fingerprint does not match. */
  match?: CachedScenarioMatch;
  outcome: CachedOutcome;
  steps: CachedStep[];
}

/* ── engine options ────────────────────────────────────────────────────────── */

export interface CachedEngineOptions {
  /** Directory holding `<scenario>.json` (defaults to `packages/agent/cache`). */
  cacheDir?: string;
  /** Pre-loaded scenarios (tests inject to stay off the filesystem). */
  scenarios?: Partial<Record<ScenarioName, CachedScenario>>;
  /** Sleep between replayed steps (injectable; tests pass a no-op for speed). */
  sleep?: (ms: number) => Promise<void>;
  /** Inter-step delay bounds in ms (SPEC §13 ≈ 400–800 ms). */
  minDelayMs?: number;
  maxDelayMs?: number;
  /** RNG for delay jitter (tests). */
  random?: () => number;
  /** Force a scenario regardless of the incident (demo override / `AGENT_CACHE_SCENARIO`). */
  forceScenario?: ScenarioName;
  /**
   * Override the real-PR behaviour. Defaults to `config.agent.cacheRealPr`, then
   * `CACHE_REAL_PR !== 'false'`, then `true` (§13/§14).
   */
  realPr?: boolean;
}

export type CachedEngineDeps = LiveEngineDeps & CachedEngineOptions;

const DEFAULT_MIN_DELAY_MS = 400;
const DEFAULT_MAX_DELAY_MS = 800;

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Resolve `packages/agent/cache` relative to this module (works from `src/` and `dist/`). */
function defaultCacheDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../cache');
}

/**
 * Load every `<scenario>.json` in `dir`. Best-effort per file — a malformed or
 * unreadable file is skipped (a partial cache is better than a crash on stage).
 */
export function loadScenariosFromDir(dir: string): Partial<Record<ScenarioName, CachedScenario>> {
  const out: Partial<Record<ScenarioName, CachedScenario>> = {};
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return out; // no cache dir yet → empty catalogue
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as CachedScenario;
      if (
        parsed &&
        (SCENARIO_NAMES as readonly string[]).includes(parsed.scenario) &&
        Array.isArray(parsed.steps)
      ) {
        out[parsed.scenario] = parsed;
      }
    } catch {
      // skip unreadable/invalid cache files
    }
  }
  return out;
}

/**
 * Pick the scenario for `incident` from the loaded catalogue (SPEC §13):
 *   1. exact `fingerprint` → scenario map (recorded at capture time);
 *   2. `suspect_deploy_sha` matches a scenario's seeded bad SHA;
 *   3. `detector === 'latency'` → `slow_db`;
 *   4. keyword scan of title + root cause (config/pricing → config_error; null/undefined → bad_deploy);
 *   5. the primary scenario (`bad_deploy`), else any loaded scenario.
 * Returns `null` only when the catalogue is empty.
 */
export function resolveScenario(
  incident: Incident,
  catalogue: Partial<Record<ScenarioName, CachedScenario>>,
): ScenarioName | null {
  const available = (Object.keys(catalogue) as ScenarioName[]).filter((k) => catalogue[k]);
  if (available.length === 0) return null;

  // 1. exact fingerprint match
  for (const name of available) {
    if (catalogue[name]!.fingerprints?.includes(incident.fingerprint)) return name;
  }
  // 2. suspect deploy SHA match
  if (incident.suspect_deploy_sha) {
    for (const name of available) {
      if (catalogue[name]!.match?.suspect_deploy_sha === incident.suspect_deploy_sha) return name;
    }
  }
  // 3. detector → latency is slow_db
  if (incident.detector === 'latency' && catalogue.slow_db) return 'slow_db';

  // 4. keyword scan
  const hay = `${incident.title} ${incident.root_cause ?? ''}`.toLowerCase();
  const matchByKeywords = (name: ScenarioName): boolean => {
    const kws = catalogue[name]?.match?.keywords ?? [];
    return kws.some((kw) => hay.includes(kw.toLowerCase()));
  };
  for (const name of available) {
    if (matchByKeywords(name)) return name;
  }
  // Built-in keyword hints (independent of what a cache declared).
  if (catalogue.config_error && /(config|pricing|missing config)/.test(hay)) return 'config_error';
  if (catalogue.slow_db && /(slow|latency|timeout|p95)/.test(hay)) return 'slow_db';
  if (catalogue.bad_deploy && /(null|undefined|cannot read|deref|typeerror)/.test(hay)) {
    return 'bad_deploy';
  }

  // 5. default
  if (catalogue[PRIMARY_SCENARIO]) return PRIMARY_SCENARIO;
  return available[0];
}

/* ── engine ────────────────────────────────────────────────────────────────── */

export class CachedEngine implements InvestigationEngine {
  private readonly db: LiveEngineDeps['db'];
  private readonly octokit: LiveEngineDeps['octokit'];
  private readonly config: AgentEngineConfig;
  private readonly sessions: EngineSessionsDao;
  private readonly steps: EngineStepsDao;
  private readonly now: () => number;

  private readonly catalogue: Partial<Record<ScenarioName, CachedScenario>>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly random: () => number;
  private readonly forceScenario?: ScenarioName;
  private readonly realPr: boolean;

  constructor(deps: CachedEngineDeps) {
    this.db = deps.db;
    this.octokit = deps.octokit;
    this.config = deps.config;
    this.sessions = deps.sessions;
    this.steps = deps.steps;
    this.now = deps.now ?? (() => Date.now());

    this.catalogue = deps.scenarios ?? loadScenariosFromDir(deps.cacheDir ?? defaultCacheDir());
    this.sleep = deps.sleep ?? realSleep;
    this.minDelayMs = deps.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
    this.maxDelayMs = deps.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.random = deps.random ?? Math.random;
    this.forceScenario = deps.forceScenario;
    this.realPr = deps.realPr ?? this.config.agent.cacheRealPr ?? envRealPr();
  }

  /** Scenarios currently available for replay (diagnostics / tests). */
  availableScenarios(): ScenarioName[] {
    return (Object.keys(this.catalogue) as ScenarioName[]).filter((k) => this.catalogue[k]);
  }

  async investigate(incident: Incident, userSink: StepSink): Promise<SessionResult> {
    const scenarioName =
      this.forceScenario && this.catalogue[this.forceScenario]
        ? this.forceScenario
        : resolveScenario(incident, this.catalogue);
    const scenario = scenarioName ? this.catalogue[scenarioName] : undefined;
    const model = scenario?.model ?? this.config.agent.model;

    const session = this.sessions.create({
      incident_id: incident.id,
      mode: 'cached',
      model,
      started_at: this.now(),
    });

    // Capture outcomes the tools/replay surface via the sink.
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

    const emit = async (step: CachedStep): Promise<void> => {
      const created_at = this.now();
      const appended = this.steps.append({
        session_id: session.id,
        type: step.type,
        tool_name: step.tool_name ?? null,
        tool_input: step.tool_input ?? null,
        tool_output: step.tool_output ?? null,
        content: step.content ?? null,
        created_at,
      });
      const full: Step = {
        session_id: session.id,
        seq: appended.seq,
        type: step.type,
        tool_name: step.tool_name ?? null,
        tool_input: step.tool_input ?? null,
        tool_output: step.tool_output ?? null,
        content: step.content ?? null,
        created_at,
        ts: created_at,
      };
      await userSink.step?.(full);
    };

    // No recorded scenario at all → degrade gracefully (escalate) instead of throwing.
    if (!scenario) {
      await emit({
        type: 'error',
        content:
          'Cached fallback has no recorded scenario to replay; escalating for human review.',
      });
      return this.finalize({
        session,
        incident,
        model,
        capture,
        prRefused: false,
        prInput: undefined,
        outcome: {
          status: 'escalated',
          decision: 'escalate',
          root_cause: 'No cached investigation available (offline fallback).',
          confidence: null,
          iterations: 1,
          cost_usd: 0,
        },
      });
    }

    let prRefused = false;
    let prInput: CreateFixPrInput | undefined;
    let skipNextCreateFixPrResult = false;

    for (const step of scenario.steps) {
      // Skip the recorded create_fix_pr tool_result — we emit the live/canned one instead.
      if (
        skipNextCreateFixPrResult &&
        step.type === 'tool_result' &&
        step.tool_name === 'create_fix_pr'
      ) {
        skipNextCreateFixPrResult = false;
        continue;
      }

      await this.pace();

      if (step.type === 'tool_call' && step.tool_name === 'create_fix_pr') {
        // Emit the intent exactly as recorded (the feed shows the same tool_call).
        await emit(step);
        prInput = step.tool_input as CreateFixPrInput;
        const cannedOutput = this.recordedPrOutput(scenario);
        const outcome = await this.runCreateFixPr(ctx, prInput, cannedOutput);
        prRefused = outcome.refused;
        await emit({
          type: 'tool_result',
          tool_name: 'create_fix_pr',
          tool_output: outcome.output,
        });
        skipNextCreateFixPrResult = true;
        continue;
      }

      if (step.type === 'conclusion') {
        await emit(step);
        const input = (step.tool_input ?? {}) as {
          root_cause?: unknown;
          confidence?: unknown;
          decision?: unknown;
        };
        const rootCause =
          typeof input.root_cause === 'string'
            ? input.root_cause
            : step.content ?? scenario.outcome.root_cause ?? '';
        const confidence =
          typeof input.confidence === 'number'
            ? input.confidence
            : scenario.outcome.confidence ?? 0;
        const decision: Decision =
          input.decision === 'escalate' || input.decision === 'propose_fix'
            ? input.decision
            : scenario.outcome.decision ?? 'escalate';
        await wrappedSink.conclusion?.({ root_cause: rootCause, confidence, decision });
        continue;
      }

      await emit(step);
    }

    return this.finalize({
      session,
      incident,
      model,
      capture,
      prRefused,
      prInput,
      outcome: scenario.outcome,
    });
  }

  /* ── create_fix_pr replay (real by default, canned on Octokit failure) ────── */

  /** Extract the create_fix_pr success payload captured at record time (the canned fallback). */
  private recordedPrOutput(scenario: CachedScenario): CreateFixPrSuccess | undefined {
    const step = scenario.steps.find(
      (s) => s.type === 'tool_result' && s.tool_name === 'create_fix_pr',
    );
    const out = step?.tool_output as Partial<CreateFixPrSuccess> | undefined;
    if (out && typeof out.pr_number === 'number' && typeof out.url === 'string') {
      return {
        pr_number: out.pr_number,
        url: out.url,
        branch: String(out.branch ?? ''),
        head_sha: String(out.head_sha ?? ''),
        base: String(out.base ?? this.octokit.defaultBranch),
      };
    }
    return undefined;
  }

  private async runCreateFixPr(
    ctx: ToolContext,
    input: CreateFixPrInput,
    canned: CreateFixPrSuccess | undefined,
  ): Promise<{ output: unknown; refused: boolean }> {
    if (this.realPr) {
      try {
        // The real tool opens a genuine PR, persists the row, links the incident,
        // and fires `sink.prCreated` — even with the LLM offline (§13).
        const output = (await runTool(ctx, 'create_fix_pr', input)) as CreateFixPrOutput;
        if ((output as { escalate?: unknown }).escalate === true) {
          return { output, refused: true };
        }
        return { output, refused: false };
      } catch {
        // Octokit failed → fall back to a canned PR record so the demo continues.
        return { output: this.cannedPr(ctx, input, canned), refused: false };
      }
    }
    return { output: this.cannedPr(ctx, input, canned), refused: false };
  }

  /**
   * Canned PR record — mirrors the real tool's DB side effects (persist row +
   * link incident `fix_proposed`) and fires `pr_created` so the feed/dashboard
   * still show a PR. Uses the PR captured at record time (a real historical PR).
   */
  private cannedPr(
    ctx: ToolContext,
    input: CreateFixPrInput,
    canned: CreateFixPrSuccess | undefined,
  ): unknown {
    const pr: CreateFixPrSuccess = canned ?? {
      pr_number: 0,
      url: `https://github.com/${this.octokit.owner}/${this.octokit.repo}/pulls`,
      branch: `oncall-ai/fix-${ctx.incident.id}-cached`,
      head_sha: '',
      base: this.octokit.defaultBranch,
    };
    try {
      const row = ctx.db.dao.pullRequests.create({
        incident_id: ctx.incident.id,
        customer_id: ctx.customer.id,
        github_pr_number: pr.pr_number,
        github_pr_id: 0,
        branch: pr.branch,
        base_branch: pr.base,
        title: input.title,
        url: pr.url,
        kind: input.kind,
        diagnostic_report: input.body,
        head_sha: pr.head_sha,
      });
      ctx.db.dao.incidents.update(ctx.incident.id, {
        status: 'fix_proposed',
        root_cause: input.root_cause,
        confidence: input.confidence,
        pr_id: row.id,
      });
    } catch {
      // Best-effort persistence — the feed still shows the PR below.
    }
    void ctx.sink.prCreated?.({ number: pr.pr_number, url: pr.url, kind: input.kind });
    return { ...pr, cached: true };
  }

  /* ── finalize (mirrors LiveClaudeEngine.finalize) ─────────────────────────── */

  private finalize(args: {
    session: { id: string };
    incident: Incident;
    model: string;
    capture: { pr?: PrCreatedData; conclusion?: ConclusionData };
    prRefused: boolean;
    prInput?: CreateFixPrInput;
    outcome: CachedOutcome;
  }): SessionResult {
    const { session, incident, model, capture, prRefused, prInput, outcome } = args;
    const conclusion = capture.conclusion;
    const pr = capture.pr;
    const fixProposed = !!pr && !prRefused;

    let status: SessionStatus;
    let decision: Decision | null;
    let rootCause: string | null;
    let confidence: number | null;

    if (conclusion) {
      rootCause = conclusion.root_cause;
      confidence = conclusion.confidence;
      if (conclusion.decision === 'propose_fix' && fixProposed) {
        status = 'completed';
        decision = 'propose_fix';
      } else {
        status = 'escalated';
        decision = 'escalate';
        this.escalateIncident(incident, rootCause, confidence);
      }
    } else if (fixProposed) {
      status = 'completed';
      decision = 'propose_fix';
      rootCause = prInput?.root_cause ?? outcome.root_cause ?? 'Fix proposed via pull request.';
      confidence = prInput?.confidence ?? outcome.confidence ?? null;
    } else {
      rootCause = outcome.root_cause ?? 'Investigation ended without a conclusion.';
      confidence = outcome.confidence ?? null;
      decision = 'escalate';
      status = outcome.status === 'failed' ? 'failed' : 'escalated';
      this.escalateIncident(incident, rootCause, confidence);
    }

    const summary = fixProposed
      ? `Replayed cached investigation → proposed a ${pr!.kind} fix as PR #${pr!.number}.`
      : 'Replayed cached investigation → escalated for human review.';

    this.sessions.finish(session.id, {
      status,
      root_cause: rootCause,
      confidence,
      decision,
      summary,
      iterations: outcome.iterations,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: outcome.cost_usd,
      completed_at: this.now(),
    });

    return {
      session_id: session.id,
      status,
      mode: 'cached',
      model,
      iterations: outcome.iterations,
      root_cause: rootCause,
      confidence,
      decision,
      cost_usd: outcome.cost_usd,
      pr_number: pr?.number ?? null,
      pr_url: pr?.url ?? null,
    };
  }

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
      // Best-effort — the session row already records the outcome.
    }
  }

  /** Sleep a jittered inter-step delay (~400–800 ms) so the feed reveals progressively. */
  private async pace(): Promise<void> {
    const span = Math.max(0, this.maxDelayMs - this.minDelayMs);
    const ms = this.minDelayMs + Math.floor(this.random() * (span + 1));
    if (ms > 0) await this.sleep(ms);
  }
}

/** Default env read for the real-PR toggle (§14 `CACHE_REAL_PR`, default true). */
function envRealPr(): boolean {
  return process.env.CACHE_REAL_PR !== 'false';
}

/**
 * The plain factory the server passes to `createEngine` as `cachedEngineFactory`
 * so `AGENT_MODE=cached` (or `auto` fallback) returns a `CachedEngine` that loads
 * the committed `cache/*.json` (SPEC §9/§13).
 */
export const cachedEngineFactory = (deps: LiveEngineDeps): InvestigationEngine =>
  new CachedEngine(deps);

/**
 * Curried variant — bind `CachedEngineOptions` (e.g. a custom `cacheDir`, a forced
 * scenario for a demo, or a no-op `sleep`) and return the `cachedEngineFactory`
 * shape `createEngine` expects.
 */
export function makeCachedEngineFactory(
  options: CachedEngineOptions,
): (deps: LiveEngineDeps) => InvestigationEngine {
  return (deps: LiveEngineDeps): InvestigationEngine =>
    new CachedEngine({ ...options, ...deps });
}
