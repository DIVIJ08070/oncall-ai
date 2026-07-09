import { describe, it, expect } from 'vitest';
import type { Incident, Step } from '@oncall/shared';
import {
  createEngine,
  createPinnedGitHub,
  isLiveEngineAvailable,
  InvestigationStreamMapper,
  LiveClaudeEngine,
  MCP_ALLOWED_TOOL_NAMES,
  mcpToolName,
  runTool,
  stripMcpPrefix,
  type AgentEngineConfig,
  type EngineSessionsDao,
  type EngineStepsDao,
  type InvestigationEngine,
  type McpFactory,
  type SdkQueryFn,
  type ToolContext,
} from '../src/index.js';
import {
  makeFakeDb,
  makeFakeGitHub,
  makeIncident,
  makeRecordingSink,
  PINNED,
  type FakeDb,
  type FakeGitHubSeed,
  type RecordingSink,
} from './helpers.js';

/* ── shared fixtures ──────────────────────────────────────────────────────── */

const BAD_SHA = 'bad0000000000000000000000000000000000000';
const PARENT_SHA = 'par0000000000000000000000000000000000000';

function makeConfig(overrides: Partial<AgentEngineConfig['agent']> = {}): AgentEngineConfig {
  return {
    github: { ...PINNED },
    agent: {
      confidenceThreshold: 0.6,
      model: 'claude-sonnet-5',
      maxIterations: 10,
      costCapUsd: 0.25,
      mode: 'live',
      useClaudeSubscription: true,
      ...overrides,
    },
  };
}

/** GitHub seed that makes get_recent_deploys / get_deploy_diff / create_fix_pr(revert) work. */
function githubSeed(): FakeGitHubSeed {
  return {
    refs: { 'heads/main': 'baseSha' },
    commits: {
      baseSha: { treeSha: 'baseTree' },
      [BAD_SHA]: {
        parents: [PARENT_SHA],
        message: 'remove cart null-guard',
        files: [
          {
            filename: 'src/routes/checkout.ts',
            status: 'modified',
            additions: 1,
            deletions: 1,
            patch: '@@\n-  const items = cart?.items ?? [];\n+  const items = cart.items;',
          },
        ],
      },
    },
    contents: {
      [`${PARENT_SHA}:src/routes/checkout.ts`]: 'const items = cart?.items ?? [];\n',
    },
    commitList: [
      { sha: BAD_SHA, message: 'remove cart null-guard' },
      { sha: PARENT_SHA, message: 'baseline' },
    ],
    prNumber: 7,
    prId: 700,
  };
}

interface FakeSessions extends EngineSessionsDao {
  created: { id: string; incident_id: string; mode: string; model: string }[];
  finished: { id: string; status: string; decision?: unknown; root_cause?: unknown }[];
}
function makeFakeSessions(): FakeSessions {
  const created: FakeSessions['created'] = [];
  const finished: FakeSessions['finished'] = [];
  return {
    created,
    finished,
    create(input) {
      const id = `ses_${created.length + 1}`;
      created.push({ id, incident_id: input.incident_id, mode: input.mode, model: input.model });
      return { id };
    },
    finish(id, fields) {
      finished.push({ id, ...fields });
      return { id, ...fields };
    },
  };
}

interface FakeSteps extends EngineStepsDao {
  appended: {
    seq: number;
    type: string;
    tool_name?: string | null;
    tool_input?: unknown;
    tool_output?: unknown;
    content?: string | null;
  }[];
}
function makeFakeSteps(): FakeSteps {
  const appended: FakeSteps['appended'] = [];
  return {
    appended,
    append(input) {
      const seq = appended.length;
      appended.push({ seq, ...input });
      return { seq };
    },
  };
}

/** SDK-free MCP factory (no real Agent SDK / subprocess). */
const fakeMcpFactory: McpFactory = () => ({ server: {}, toolNames: MCP_ALLOWED_TOOL_NAMES });

/* ── scripted fake query ──────────────────────────────────────────────────── */

interface ScriptTurn {
  thought?: string;
  tool?: { name: string; input: unknown };
}

interface ScriptedResult {
  status?: 'success' | 'error_during_execution' | 'error_max_turns';
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
}

/** Build an SdkQueryFn that replays `script`, executing each real tool against ctx. */
function scriptedQuery(
  script: ScriptTurn[],
  opts: { result?: ScriptedResult; capturedOptions?: { value?: Record<string, unknown> } } = {},
): SdkQueryFn {
  return function query(args) {
    if (opts.capturedOptions) opts.capturedOptions.value = args.options;
    const ctx = args.ctx as ToolContext;
    async function* gen() {
      yield { type: 'system', subtype: 'init' } as never;
      let id = 0;
      for (const turn of script) {
        const content: unknown[] = [];
        if (turn.thought) content.push({ type: 'text', text: turn.thought });
        let toolUseId: string | undefined;
        if (turn.tool) {
          toolUseId = `tu_${++id}`;
          content.push({
            type: 'tool_use',
            id: toolUseId,
            name: mcpToolName(turn.tool.name),
            input: turn.tool.input,
          });
        }
        yield { type: 'assistant', message: { content } } as never;
        if (turn.tool && toolUseId) {
          let output: unknown;
          let isError = false;
          try {
            output = await runTool(ctx, turn.tool.name as never, turn.tool.input);
          } catch (err) {
            output = { error: err instanceof Error ? err.message : String(err) };
            isError = true;
          }
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  content: [{ type: 'text', text: JSON.stringify(output) }],
                  is_error: isError,
                },
              ],
            },
          } as never;
        }
      }
      const r = opts.result ?? {};
      yield {
        type: 'result',
        subtype: r.status ?? 'success',
        usage: { input_tokens: r.input_tokens ?? 120, output_tokens: r.output_tokens ?? 60 },
        total_cost_usd: r.cost_usd ?? 0,
        num_turns: script.length,
      } as never;
    }
    return gen();
  };
}

interface Harness {
  engine: InvestigationEngine;
  incident: Incident;
  db: FakeDb;
  sessions: FakeSessions;
  steps: FakeSteps;
  sink: RecordingSink & { steps: Step[] };
  capturedOptions: { value?: Record<string, unknown> };
}

function makeHarness(
  script: ScriptTurn[],
  opts: {
    config?: AgentEngineConfig;
    result?: ScriptedResult;
    seed?: FakeGitHubSeed;
    incident?: Partial<Incident>;
  } = {},
): Harness {
  const config = opts.config ?? makeConfig();
  const incident = makeIncident({ suspect_deploy_sha: BAD_SHA, ...opts.incident });
  const db = makeFakeDb({}, incident);
  const github = makeFakeGitHub(opts.seed ?? githubSeed());
  const octokit = createPinnedGitHub(github.client, config.github);
  const sessions = makeFakeSessions();
  const steps = makeFakeSteps();
  const capturedOptions: { value?: Record<string, unknown> } = {};

  const baseSink = makeRecordingSink();
  const emittedSteps: Step[] = [];
  const sink = Object.assign(baseSink, {
    steps: emittedSteps,
    step: (s: Step) => void emittedSteps.push(s),
  });

  const engine = new LiveClaudeEngine({
    db,
    octokit,
    config,
    sessions,
    steps,
    queryFn: scriptedQuery(script, { result: opts.result, capturedOptions }),
    mcpFactory: fakeMcpFactory,
    now: () => 1_752_000_000_000,
  });

  return { engine, incident, db, sessions, steps, sink, capturedOptions };
}

/* ── 1. happy path ────────────────────────────────────────────────────────── */

describe('LiveClaudeEngine — happy path (investigate → revert PR → propose_fix)', () => {
  const script: ScriptTurn[] = [
    { thought: 'Checking recent deploys for a suspect change.', tool: { name: 'get_recent_deploys', input: { limit: 5 } } },
    { thought: 'The bad deploy removed a null guard on checkout.', tool: { name: 'get_deploy_diff', input: { sha: BAD_SHA } } },
    {
      tool: {
        name: 'create_fix_pr',
        input: {
          kind: 'revert',
          confidence: 0.9,
          root_cause: 'Null deref introduced by the bad deploy.',
          title: 'Revert "remove cart null-guard"',
          body: '## Root Cause\nNull deref.\n\n_Generated by OnCall AI._',
          revert_sha: BAD_SHA,
        },
      },
    },
    {
      tool: {
        name: 'submit_findings',
        input: {
          root_cause: 'Null deref from the bad deploy on checkout-api.',
          evidence: [{ type: 'tool', tool: 'get_deploy_diff', ref: BAD_SHA }],
          confidence: 0.9,
          decision: 'propose_fix',
        },
      },
    },
  ];

  it('opens a real PR, links the incident fix_proposed, and completes', async () => {
    const h = makeHarness(script);
    const result = await h.engine.investigate(h.incident, h.sink);

    expect(result.status).toBe('completed');
    expect(result.decision).toBe('propose_fix');
    expect(result.mode).toBe('live');
    expect(result.pr_number).toBe(7);
    expect(result.pr_url).toContain('/pull/7');
    expect(result.root_cause).toBe('Null deref from the bad deploy on checkout-api.');
    expect(result.confidence).toBe(0.9);
    expect(result.iterations).toBe(4);

    // create_fix_pr persisted a PR row + linked the incident (from the tool itself).
    expect(h.db.createdPrs).toHaveLength(1);
    expect(h.db.patches.some((p) => p.patch.status === 'fix_proposed')).toBe(true);

    // sink surfaced pr_created + conclusion exactly once.
    expect(h.sink.prCreatedCalls).toHaveLength(1);
    expect(h.sink.conclusionCalls).toHaveLength(1);
    expect(h.sink.conclusionCalls[0].decision).toBe('propose_fix');

    // session finished completed.
    expect(h.sessions.finished).toHaveLength(1);
    expect(h.sessions.finished[0].status).toBe('completed');
    expect(h.sessions.finished[0].decision).toBe('propose_fix');
  });

  it('persists + streams a step per SDK message (thought / tool_call / tool_result / conclusion)', async () => {
    const h = makeHarness(script);
    await h.engine.investigate(h.incident, h.sink);

    const types = h.steps.appended.map((s) => s.type);
    expect(types.filter((t) => t === 'thought').length).toBe(2);
    expect(types.filter((t) => t === 'tool_call').length).toBe(3); // deploys, diff, create_fix_pr
    expect(types.filter((t) => t === 'tool_result').length).toBe(3);
    expect(types.filter((t) => t === 'conclusion').length).toBe(1); // submit_findings → conclusion

    // Every persisted step was also emitted to the sink, in the same order, seq monotonic.
    expect(h.sink.steps).toHaveLength(h.steps.appended.length);
    expect(h.sink.steps.map((s) => s.seq)).toEqual(h.steps.appended.map((s) => s.seq));
    for (let i = 0; i < h.sink.steps.length; i++) expect(h.sink.steps[i].seq).toBe(i);

    // The conclusion step carries the structured findings + root_cause content.
    const conclusion = h.steps.appended.find((s) => s.type === 'conclusion')!;
    expect(conclusion.tool_name).toBe('submit_findings');
    expect((conclusion.tool_input as { decision?: string }).decision).toBe('propose_fix');
    expect(conclusion.content).toContain('Null deref');

    // The create_fix_pr tool_result carries the real bounded PR output.
    const prResult = h.steps.appended.find(
      (s) => s.type === 'tool_result' && s.tool_name === 'create_fix_pr',
    )!;
    expect((prResult.tool_output as { pr_number?: number }).pr_number).toBe(7);
  });

  it('locks the sandbox to exactly the 7 allowlisted tools with no built-ins', async () => {
    const h = makeHarness(script);
    await h.engine.investigate(h.incident, h.sink);
    const opts = h.capturedOptions.value!;
    expect(opts.allowedTools).toEqual(MCP_ALLOWED_TOOL_NAMES);
    expect((opts.allowedTools as string[]).every((n) => n.startsWith('mcp__oncall__'))).toBe(true);
    expect((opts.allowedTools as string[])).toHaveLength(7);
    expect(opts.permissionMode).toBe('dontAsk');
    expect(opts.settingSources).toEqual([]);
    expect(opts.maxTurns).toBe(10);
    expect(opts.model).toBe('claude-sonnet-5');
    // Built-ins are explicitly denied as defense in depth.
    expect(opts.disallowedTools).toContain('Bash');
    expect(opts.disallowedTools).toContain('Read');
  });
});

/* ── 1b. PR opened but the loop stops before submit_findings ───────────────── */

describe('LiveClaudeEngine — PR opened but capped before submit_findings', () => {
  it('reports completed/propose_fix and does NOT downgrade the fix_proposed incident', async () => {
    // The agent opens a real PR, then the run ends (no submit_findings reached).
    const script: ScriptTurn[] = [
      { thought: 'Reverting the bad deploy.', tool: { name: 'get_deploy_diff', input: { sha: BAD_SHA } } },
      {
        tool: {
          name: 'create_fix_pr',
          input: {
            kind: 'revert',
            confidence: 0.95,
            root_cause: 'Null deref from the bad deploy on checkout-api.',
            title: 'Revert bad deploy',
            body: 'diagnostic report',
            revert_sha: BAD_SHA,
          },
        },
      },
    ];
    const h = makeHarness(script);
    const result = await h.engine.investigate(h.incident, h.sink);

    expect(result.status).toBe('completed');
    expect(result.decision).toBe('propose_fix');
    expect(result.pr_number).toBe(7);
    expect(result.root_cause).toBe('Null deref from the bad deploy on checkout-api.');
    expect(result.confidence).toBe(0.95);

    // Incident stays fix_proposed (set by create_fix_pr) — never escalated.
    expect(h.db.patches.some((p) => p.patch.status === 'fix_proposed')).toBe(true);
    expect(h.db.patches.some((p) => p.patch.status === 'escalated')).toBe(false);
    expect(h.sessions.finished[0].status).toBe('completed');
  });
});

/* ── 2. escalation: agent decides escalate ────────────────────────────────── */

describe('LiveClaudeEngine — escalation on decision=escalate', () => {
  it('escalates the incident, opens no PR, and completes as escalated', async () => {
    const script: ScriptTurn[] = [
      { thought: 'Metrics are noisy; I cannot isolate a culprit deploy.' },
      {
        tool: {
          name: 'submit_findings',
          input: {
            root_cause: 'Inconclusive — multiple candidate changes.',
            evidence: [],
            confidence: 0.4,
            decision: 'escalate',
          },
        },
      },
    ];
    const h = makeHarness(script);
    const result = await h.engine.investigate(h.incident, h.sink);

    expect(result.status).toBe('escalated');
    expect(result.decision).toBe('escalate');
    expect(result.pr_number).toBeNull();
    expect(h.db.createdPrs).toHaveLength(0);
    expect(h.db.patches.some((p) => p.patch.status === 'escalated')).toBe(true);
    expect(h.sink.prCreatedCalls).toHaveLength(0);
    expect(h.sink.conclusionCalls[0].decision).toBe('escalate');
    expect(h.sessions.finished[0].status).toBe('escalated');
  });
});

/* ── 3. escalation: create_fix_pr refused (FR-13) ─────────────────────────── */

describe('LiveClaudeEngine — escalation on create_fix_pr refusal (FR-13)', () => {
  it('refuses a low-confidence PR (no write) and escalates', async () => {
    const script: ScriptTurn[] = [
      {
        tool: {
          name: 'create_fix_pr',
          input: {
            kind: 'revert',
            confidence: 0.3, // below the 0.6 threshold → refusal
            root_cause: 'maybe the bad deploy',
            title: 'Revert bad deploy',
            body: 'unsure',
            revert_sha: BAD_SHA,
          },
        },
      },
      {
        tool: {
          name: 'submit_findings',
          input: {
            root_cause: 'Low confidence — needs human review.',
            evidence: [{ type: 'tool', tool: 'get_deploy_diff', ref: BAD_SHA }],
            confidence: 0.3,
            decision: 'escalate',
          },
        },
      },
    ];
    const h = makeHarness(script);
    const result = await h.engine.investigate(h.incident, h.sink);

    expect(result.status).toBe('escalated');
    expect(result.pr_number).toBeNull();
    expect(h.db.createdPrs).toHaveLength(0); // refusal made NO GitHub write / PR row
    expect(h.sink.prCreatedCalls).toHaveLength(0);
    expect(h.db.patches.some((p) => p.patch.status === 'escalated')).toBe(true);

    // The refused create_fix_pr tool_result was persisted with the escalate flag.
    const refusal = h.steps.appended.find(
      (s) => s.type === 'tool_result' && s.tool_name === 'create_fix_pr',
    )!;
    expect((refusal.tool_output as { escalate?: boolean }).escalate).toBe(true);
  });

  it('escalates even when the agent contradicts a refusal with propose_fix', async () => {
    const script: ScriptTurn[] = [
      {
        tool: {
          name: 'create_fix_pr',
          input: {
            kind: 'revert',
            confidence: 0.2,
            root_cause: 'guess',
            title: 'Revert',
            body: 'x',
            revert_sha: BAD_SHA,
          },
        },
      },
      {
        tool: {
          name: 'submit_findings',
          input: {
            root_cause: 'I think it is the deploy.',
            evidence: [],
            confidence: 0.2,
            decision: 'propose_fix', // contradicts the refusal — engine must still escalate
          },
        },
      },
    ];
    const h = makeHarness(script);
    const result = await h.engine.investigate(h.incident, h.sink);
    expect(result.status).toBe('escalated');
    expect(result.decision).toBe('escalate');
    expect(result.pr_number).toBeNull();
  });
});

/* ── 4. iteration cap ─────────────────────────────────────────────────────── */

describe('LiveClaudeEngine — iteration cap (AGENT_MAX_ITERATIONS)', () => {
  it('force-escalates when the SDK hits maxTurns (error_max_turns) without a conclusion', async () => {
    // The SDK enforces maxTurns=3, exhausts it over 3 turns, and reports error_max_turns.
    const script: ScriptTurn[] = Array.from({ length: 3 }, (_, i) => ({
      thought: `Still investigating, turn ${i + 1}…`,
    }));
    const h = makeHarness(script, {
      config: makeConfig({ maxIterations: 3 }),
      result: { status: 'error_max_turns' },
    });
    const result = await h.engine.investigate(h.incident, h.sink);

    expect(result.iterations).toBe(3); // num_turns from the result frame
    expect(result.status).toBe('escalated');
    expect(result.decision).toBe('escalate');
    expect(result.pr_number).toBeNull();
    expect(h.sink.conclusionCalls).toHaveLength(0); // never reached submit_findings
    expect(h.steps.appended.filter((s) => s.type === 'thought')).toHaveLength(3);
    expect(h.db.patches.some((p) => p.patch.status === 'escalated')).toBe(true);
    expect(h.sessions.finished[0].status).toBe('escalated');

    // passes maxTurns=3 to the SDK as the real cap.
    expect(h.capturedOptions.value!.maxTurns).toBe(3);
  });

  it('runaway guard terminates a generator that never yields a result or conclusion', async () => {
    // A misbehaving SDK that streams assistant messages forever must still terminate.
    const runawayQuery: SdkQueryFn = () => {
      async function* gen() {
        yield { type: 'system', subtype: 'init' } as never;
        for (let i = 0; ; i++) {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: `loop ${i}` }] } } as never;
        }
      }
      return gen();
    };
    const config = makeConfig({ maxIterations: 2 });
    const incident = makeIncident({ suspect_deploy_sha: BAD_SHA });
    const db = makeFakeDb({}, incident);
    const octokit = createPinnedGitHub(makeFakeGitHub(githubSeed()).client, config.github);
    const sessions = makeFakeSessions();
    const steps = makeFakeSteps();
    const sink = makeRecordingSink();
    const engine = new LiveClaudeEngine({
      db, octokit, config, sessions, steps,
      queryFn: runawayQuery, mcpFactory: fakeMcpFactory, now: () => 1,
    });

    const result = await engine.investigate(incident, sink); // must resolve, not hang
    expect(result.status).toBe('escalated');
    expect(result.decision).toBe('escalate');
    // Bounded by the runaway ceiling (maxIterations*8 + 16 messages), not infinite.
    expect(result.iterations).toBeLessThan(40);
    expect(result.iterations).toBeGreaterThan(10);
  });
});

/* ── 5. SDK error ─────────────────────────────────────────────────────────── */

describe('LiveClaudeEngine — SDK error handling', () => {
  it('marks the session failed and escalates when query() throws', async () => {
    const throwingQuery: SdkQueryFn = () => {
      async function* gen() {
        yield { type: 'system', subtype: 'init' } as never;
        throw new Error('subscription auth failed');
      }
      return gen();
    };
    const config = makeConfig();
    const incident = makeIncident({ suspect_deploy_sha: BAD_SHA });
    const db = makeFakeDb({}, incident);
    const github = makeFakeGitHub(githubSeed());
    const octokit = createPinnedGitHub(github.client, config.github);
    const sessions = makeFakeSessions();
    const steps = makeFakeSteps();
    const sink = makeRecordingSink();

    const engine = new LiveClaudeEngine({
      db, octokit, config, sessions, steps,
      queryFn: throwingQuery, mcpFactory: fakeMcpFactory, now: () => 1,
    });
    const result = await engine.investigate(incident, sink);

    expect(result.status).toBe('failed');
    expect(result.decision).toBe('escalate');
    expect(steps.appended.some((s) => s.type === 'error')).toBe(true);
    expect(sessions.finished[0].status).toBe('failed');
    expect(db.patches.some((p) => p.patch.status === 'escalated')).toBe(true);
  });
});

/* ── 6. stream mapper unit ────────────────────────────────────────────────── */

describe('InvestigationStreamMapper', () => {
  it('maps assistant text/tool_use and user tool_result, stripping the mcp prefix', () => {
    const m = new InvestigationStreamMapper();
    const s1 = m.map({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Looking at logs.' },
          { type: 'tool_use', id: 'tu1', name: 'mcp__oncall__search_logs', input: { limit: 5 } },
        ],
      },
    } as never);
    expect(s1.map((s) => s.type)).toEqual(['thought', 'tool_call']);
    expect(s1[1].tool_name).toBe('search_logs');

    const s2 = m.map({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: '{"returned":0}' }] },
        ],
      },
    } as never);
    expect(s2[0].type).toBe('tool_result');
    expect(s2[0].tool_name).toBe('search_logs');
    expect((s2[0].tool_output as { returned: number }).returned).toBe(0);
  });

  it('maps submit_findings tool_use to a conclusion step and skips its ack', () => {
    const m = new InvestigationStreamMapper();
    const s1 = m.map({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tuC',
            name: 'mcp__oncall__submit_findings',
            input: { root_cause: 'bad deploy', decision: 'propose_fix', confidence: 0.9, evidence: [] },
          },
        ],
      },
    } as never);
    expect(s1[0].type).toBe('conclusion');
    expect(s1[0].content).toBe('bad deploy');

    const s2 = m.map({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tuC', content: '{"acknowledged":true}' }] },
    } as never);
    expect(s2).toHaveLength(0); // ack skipped
  });

  it('flags a create_fix_pr refusal from its tool_result', () => {
    const m = new InvestigationStreamMapper();
    m.map({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tuP', name: 'mcp__oncall__create_fix_pr', input: {} }] },
    } as never);
    expect(m.createFixPrRefused).toBe(false);
    m.map({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tuP', content: '{"escalate":true,"reason":"confidence below threshold"}' },
        ],
      },
    } as never);
    expect(m.createFixPrRefused).toBe(true);
  });

  it('stripMcpPrefix leaves non-prefixed names alone', () => {
    expect(stripMcpPrefix('mcp__oncall__read_file')).toBe('read_file');
    expect(stripMcpPrefix('read_file')).toBe('read_file');
  });
});

/* ── 7. factory ───────────────────────────────────────────────────────────── */

describe('createEngine factory (live | cached | auto)', () => {
  const baseDeps = () => {
    const config = makeConfig();
    const incident = makeIncident();
    const db = makeFakeDb({}, incident);
    const octokit = createPinnedGitHub(makeFakeGitHub().client, config.github);
    return { db, octokit, config, sessions: makeFakeSessions(), steps: makeFakeSteps(), queryFn: scriptedQuery([]), mcpFactory: fakeMcpFactory };
  };

  it('mode=live returns a LiveClaudeEngine', () => {
    const engine = createEngine({ ...baseDeps(), config: makeConfig({ mode: 'live' }) });
    expect(engine).toBeInstanceOf(LiveClaudeEngine);
  });

  it('mode=cached without a cached factory throws a clear error', () => {
    expect(() => createEngine({ ...baseDeps(), config: makeConfig({ mode: 'cached' }) })).toThrow(
      /CachedEngine is not available/,
    );
  });

  it('mode=cached with a cached factory returns the cached engine', () => {
    const cached: InvestigationEngine = { investigate: async () => ({}) as never };
    const engine = createEngine({
      ...baseDeps(),
      config: makeConfig({ mode: 'cached' }),
      cachedEngineFactory: () => cached,
    });
    expect(engine).toBe(cached);
  });

  it('mode=auto picks live when available, cached when not', () => {
    const cached: InvestigationEngine = { investigate: async () => ({}) as never };
    const liveOne = createEngine({
      ...baseDeps(),
      config: makeConfig({ mode: 'auto' }),
      cachedEngineFactory: () => cached,
      isLiveAvailable: () => true,
    });
    expect(liveOne).toBeInstanceOf(LiveClaudeEngine);

    const cachedOne = createEngine({
      ...baseDeps(),
      config: makeConfig({ mode: 'auto' }),
      cachedEngineFactory: () => cached,
      isLiveAvailable: () => false,
    });
    expect(cachedOne).toBe(cached);
  });

  it('isLiveEngineAvailable honors an explicit API key and the subscription toggle', () => {
    expect(
      isLiveEngineAvailable(makeConfig({ useClaudeSubscription: false, anthropicApiKey: 'sk-xyz' })),
    ).toBe(true);
    expect(
      isLiveEngineAvailable(makeConfig({ useClaudeSubscription: false, anthropicApiKey: '' })),
    ).toBe(false);
  });
});
