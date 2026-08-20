/**
 * QA C8 — independent spec-derived verification of `CachedEngine` + replay +
 * real-PR fallback + factory (SPEC §13/NFR-09, §9 engine interface/NFR-06 parity).
 *
 * Authored by QA from `features/oncall-ai/qa/TEST_CASES-C8.md` (derived from the
 * SPEC BEFORE reading the implementation). Self-contained fakes — does NOT import
 * the developer's `test/helpers.ts`, so the assertions are independent of the
 * developer's fixtures. Exercises the REAL committed `cache/*.json` through the
 * REAL `CachedEngine`/`createEngine` (offline; no network, no live SDK).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import type { Incident, Step, PullRequestRec } from '@oncall/shared';
import {
  CachedEngine,
  cachedEngineFactory,
  createEngine,
  loadScenariosFromDir,
  resolveScenario,
  LiveClaudeEngine,
  SCENARIO_NAMES,
  type AgentEngineConfig,
  type CachedScenario,
  type EngineSessionsDao,
  type EngineStepsDao,
  type PinnedGitHub,
  type ScenarioName,
} from '../src/index.js';
import type { StepSink, ToolDb } from '../src/ports.js';

const REAL_CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../cache');
const NO_SLEEP = async (): Promise<void> => {};

/* ── self-contained fakes ─────────────────────────────────────────────────── */

function makeIncident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'inc_qa_c8',
    customer_id: 'cust_1',
    service: 'checkout-api',
    detector: 'error_rate',
    fingerprint: 'fp-unknown',
    title: 'Elevated error rate on checkout-api',
    status: 'investigating',
    severity: 'high',
    threshold_value: 0.2,
    observed_value: 0.85,
    first_error_at: 1000,
    detected_at: 1000,
    opened_at: 1000,
    root_cause: null,
    confidence: null,
    pr_id: null,
    suspect_deploy_sha: null,
    resolved_at: null,
    postmortem: null,
    updated_at: 1000,
    ...over,
  };
}

interface FakeState {
  sessionFinish?: Record<string, unknown>;
  prRows: unknown[];
  incidentPatches: Record<string, unknown>[];
  revertCalls: unknown[];
}

/** A recording StepSink that captures every emitted event in order. */
function makeSink(): { sink: StepSink; steps: Step[]; prs: unknown[]; conclusions: unknown[]; order: string[] } {
  const steps: Step[] = [];
  const prs: unknown[] = [];
  const conclusions: unknown[] = [];
  const order: string[] = [];
  return {
    steps,
    prs,
    conclusions,
    order,
    sink: {
      step: (s) => {
        steps.push(s);
        order.push(`step:${s.type}`);
      },
      prCreated: (d) => {
        prs.push(d);
        order.push('pr');
      },
      conclusion: (d) => {
        conclusions.push(d);
        order.push('conclusion');
      },
    },
  };
}

interface DepsOpts {
  revertThrows?: boolean;
  revertResult?: { number: number; url: string };
  confidenceThreshold?: number;
  cacheRealPr?: boolean;
}

function makeDeps(state: FakeState, opts: DepsOpts = {}): {
  db: ToolDb;
  octokit: PinnedGitHub;
  config: AgentEngineConfig;
  sessions: EngineSessionsDao;
  steps: EngineStepsDao;
} {
  let seq = 0;
  const sessions: EngineSessionsDao = {
    create: () => ({ id: 'sess_qa_c8' }),
    finish: (_id, fields) => {
      state.sessionFinish = fields as Record<string, unknown>;
      return undefined;
    },
  };
  const steps: EngineStepsDao = {
    append: () => ({ seq: ++seq }),
  };
  const db: ToolDb = {
    dao: {
      logEvents: { query: () => [] },
      metricSamples: { latestForService: () => null, seriesForService: () => [] },
      deploys: { getBySha: () => null, getCurrent: () => null, listRecent: () => [] },
      incidents: {
        update: (_id, patch) => {
          state.incidentPatches.push(patch as Record<string, unknown>);
          return null;
        },
      },
      pullRequests: {
        create: (input) => {
          const row = { id: 'pr_row_1', state: 'open', ...input } as unknown as PullRequestRec;
          state.prRows.push(row);
          return row;
        },
      },
      services: { getByName: () => null },
    },
  };
  const revert = opts.revertResult ?? { number: 4242, url: 'https://github.com/DIVIJ08070/oncall-ai-victim/pull/4242' };
  const octokit: PinnedGitHub = {
    owner: 'DIVIJ08070',
    repo: 'oncall-ai-victim',
    defaultBranch: 'main',
    listCommits: async () => [],
    getCommitDiff: async () => { throw new Error('not needed for replay'); },
    compare: async () => { throw new Error('not needed for replay'); },
    getFile: async () => { throw new Error('not needed for replay'); },
    openRevertPr: async (args) => {
      state.revertCalls.push(args);
      if (opts.revertThrows) throw new Error('simulated Octokit failure (503)');
      return {
        number: revert.number,
        id: revert.number,
        url: revert.url,
        branch: args.branch,
        base: 'main',
        head_sha: 'deadbeef',
      };
    },
    openPatchPr: async () => { throw new Error('not expected for revert scenarios'); },
  };
  const config: AgentEngineConfig = {
    github: {
      owner: 'DIVIJ08070',
      repo: 'oncall-ai-victim',
      defaultBranch: 'main',
      protectedBranches: ['main', 'master'],
    },
    agent: {
      confidenceThreshold: opts.confidenceThreshold ?? 0.6,
      model: 'claude-sonnet-5',
      maxIterations: 10,
      costCapUsd: 0.25,
      cacheRealPr: opts.cacheRealPr,
    },
  };
  return { db, octokit, config, sessions, steps };
}

/** Load the REAL committed caches once. */
const REAL = loadScenariosFromDir(REAL_CACHE_DIR);

/* ── A. Interface / parity (NFR-06) ──────────────────────────────────────── */

describe('C8-A: CachedEngine implements InvestigationEngine identically (NFR-06 parity)', () => {
  it('TC-01: exposes investigate(incident, sink) → SessionResult with the live-engine shape', async () => {
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const engine = new CachedEngine({ ...makeDeps(state), scenarios: REAL, sleep: NO_SLEEP });
    expect(typeof engine.investigate).toBe('function');
    const { sink } = makeSink();
    const res = await engine.investigate(makeIncident({ fingerprint: 'record-bad_deploy' }), sink);
    // Same SessionResult fields the live engine returns.
    for (const k of ['session_id', 'status', 'mode', 'model', 'iterations', 'root_cause', 'confidence', 'decision', 'cost_usd', 'pr_number', 'pr_url']) {
      expect(res).toHaveProperty(k);
    }
    expect(res.mode).toBe('cached');
  });

  it('TC-02: replays the recorded step-type sequence EXACTLY to the sink (indistinguishable feed)', async () => {
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const engine = new CachedEngine({ ...makeDeps(state), scenarios: REAL, sleep: NO_SLEEP, realPr: false });
    const { sink, steps } = makeSink();
    await engine.investigate(makeIncident({ fingerprint: 'record-bad_deploy' }), sink);
    const recorded = REAL.bad_deploy!.steps.map((s) => s.type);
    const emitted = steps.map((s) => s.type);
    expect(emitted).toEqual(recorded); // same order, same types
    expect(emitted).toContain('thought');
    expect(emitted).toContain('tool_call');
    expect(emitted).toContain('tool_result');
    expect(emitted).toContain('conclusion');
  });

  it('TC-03: persists one step per replayed step with strictly monotonic seq (1..N)', async () => {
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const engine = new CachedEngine({ ...makeDeps(state), scenarios: REAL, sleep: NO_SLEEP, realPr: false });
    const { sink, steps } = makeSink();
    await engine.investigate(makeIncident({ fingerprint: 'record-bad_deploy' }), sink);
    const seqs = steps.map((s) => s.seq);
    expect(seqs).toEqual(steps.map((_, i) => i + 1)); // 1,2,3,...,N no gaps/dupes
    expect(seqs.length).toBe(REAL.bad_deploy!.steps.length);
  });

  it('TC-04: emits step per step + prCreated once + conclusion once, conclusion last', async () => {
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const engine = new CachedEngine({ ...makeDeps(state), scenarios: REAL, sleep: NO_SLEEP, realPr: false });
    const { sink, prs, conclusions, order } = makeSink();
    await engine.investigate(makeIncident({ fingerprint: 'record-bad_deploy' }), sink);
    expect(prs.length).toBe(1);
    expect(conclusions.length).toBe(1);
    expect(order[order.length - 1]).toBe('conclusion'); // conclusion is last
    expect(order.indexOf('pr')).toBeLessThan(order.lastIndexOf('conclusion')); // PR before conclusion
  });

  it('TC-05: paces with the injectable sleep between steps (delays are cosmetic, not semantic)', async () => {
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const sleepSpy = vi.fn(async () => {});
    const engine = new CachedEngine({
      ...makeDeps(state),
      scenarios: REAL,
      sleep: sleepSpy,
      realPr: false,
      minDelayMs: 400,
      maxDelayMs: 800,
      random: () => 0.5,
    });
    const { sink, steps } = makeSink();
    await engine.investigate(makeIncident({ fingerprint: 'record-bad_deploy' }), sink);
    expect(sleepSpy).toHaveBeenCalled();
    // requested delay lands in the documented ~400–800ms band
    const ms = sleepSpy.mock.calls[0][0] as number;
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThanOrEqual(800);
    // ordering identical to the no-sleep run (delay is not semantic)
    expect(steps.map((s) => s.type)).toEqual(REAL.bad_deploy!.steps.map((s) => s.type));
  });

  it('TC-06: propose_fix scenario → session completed + finish{root_cause,confidence,decision}', async () => {
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const engine = new CachedEngine({ ...makeDeps(state), scenarios: REAL, sleep: NO_SLEEP, realPr: false });
    const { sink } = makeSink();
    const res = await engine.investigate(makeIncident({ fingerprint: 'record-bad_deploy' }), sink);
    expect(res.status).toBe('completed');
    expect(res.decision).toBe('propose_fix');
    expect(state.sessionFinish).toBeDefined();
    expect(state.sessionFinish!.status).toBe('completed');
    expect(typeof state.sessionFinish!.root_cause).toBe('string');
    expect(typeof state.sessionFinish!.confidence).toBe('number');
    expect(state.sessionFinish!.decision).toBe('propose_fix');
  });

  it('TC-07: escalate-conclusion scenario → session escalated, no PR', async () => {
    const escalateScenario: CachedScenario = {
      scenario: 'bad_deploy',
      recorded_at: 1,
      model: 'claude-sonnet-5',
      fingerprints: ['fp-escalate'],
      outcome: { status: 'escalated', decision: 'escalate', root_cause: 'unclear', confidence: 0.3, iterations: 3, cost_usd: 0 },
      steps: [
        { type: 'thought', content: 'looking' },
        { type: 'conclusion', tool_input: { root_cause: 'unclear', confidence: 0.3, decision: 'escalate' } },
      ],
    };
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const engine = new CachedEngine({ ...makeDeps(state), scenarios: { bad_deploy: escalateScenario }, sleep: NO_SLEEP });
    const { sink, prs } = makeSink();
    const res = await engine.investigate(makeIncident({ fingerprint: 'fp-escalate' }), sink);
    expect(res.status).toBe('escalated');
    expect(res.decision).toBe('escalate');
    expect(res.pr_number).toBeNull();
    expect(prs.length).toBe(0);
    expect(state.incidentPatches.some((p) => p.status === 'escalated')).toBe(true);
  });
});

/* ── B. Scenario selection (§13) ─────────────────────────────────────────── */

describe('C8-B: scenario selection — fingerprint map + documented fallbacks (§13)', () => {
  it('TC-08: exact fingerprint match wins', () => {
    expect(resolveScenario(makeIncident({ fingerprint: 'record-slow_db' }), REAL)).toBe('slow_db');
    expect(resolveScenario(makeIncident({ fingerprint: 'record-config_error' }), REAL)).toBe('config_error');
  });

  it('TC-09: suspect_deploy_sha fallback routes to the scenario of that bad SHA', () => {
    // config_error seeded SHA, but a non-matching fingerprint + non-config title
    const inc = makeIncident({
      fingerprint: 'fp-none',
      suspect_deploy_sha: '4e677cc62a1d10254573814540ede80ac9be140e',
      detector: 'error_rate',
      title: 'errors up',
      root_cause: null,
    });
    expect(resolveScenario(inc, REAL)).toBe('config_error');
  });

  it('TC-10: detector==="latency" fallback → slow_db', () => {
    const inc = makeIncident({ fingerprint: 'fp-none', detector: 'latency', title: 'p-times up', root_cause: null, suspect_deploy_sha: null });
    expect(resolveScenario(inc, REAL)).toBe('slow_db');
  });

  it('TC-11: keyword scan fallback (title/root_cause) → config_error', () => {
    const inc = makeIncident({ fingerprint: 'fp-none', detector: 'error_rate', title: 'Missing config PRICING_TABLE on pricing', root_cause: null, suspect_deploy_sha: null });
    expect(resolveScenario(inc, REAL)).toBe('config_error');
  });

  it('TC-12: default → primary bad_deploy when nothing else matches', () => {
    const inc = makeIncident({ fingerprint: 'fp-none', detector: 'silence', title: 'zzz', root_cause: 'nothing recognizable here', suspect_deploy_sha: null });
    expect(resolveScenario(inc, REAL)).toBe('bad_deploy');
  });

  it('TC-13: empty catalogue → null (engine will gracefully escalate)', () => {
    expect(resolveScenario(makeIncident(), {})).toBeNull();
  });

  it('TC-14: all three fingerprints route to their own scenario cache', () => {
    expect(resolveScenario(makeIncident({ fingerprint: 'record-bad_deploy' }), REAL)).toBe('bad_deploy');
    expect(resolveScenario(makeIncident({ fingerprint: 'record-slow_db' }), REAL)).toBe('slow_db');
    expect(resolveScenario(makeIncident({ fingerprint: 'record-config_error' }), REAL)).toBe('config_error');
  });

  it('TC-13b: empty catalogue → engine emits an error step and escalates (no crash)', async () => {
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const engine = new CachedEngine({ ...makeDeps(state), scenarios: {}, sleep: NO_SLEEP });
    const { sink, steps } = makeSink();
    const res = await engine.investigate(makeIncident(), sink);
    expect(res.status).toBe('escalated');
    expect(steps.some((s) => s.type === 'error')).toBe(true);
  });
});

/* ── C. Cache files exist / well-formed / replay to completed+propose_fix ──── */

describe('C8-C: committed cache/*.json exist, well-formed, replay to completed/propose_fix (§13)', () => {
  it('TC-15: all three scenario caches load from packages/agent/cache', () => {
    for (const name of SCENARIO_NAMES) {
      expect(REAL[name], `cache/${name}.json`).toBeDefined();
      expect(Array.isArray(REAL[name]!.steps)).toBe(true);
      expect(REAL[name]!.steps.length).toBeGreaterThan(0);
    }
  });

  it('TC-16/17: each cache has ≥1 tool_call, ≥1 tool_result, exactly one conclusion (+ create_fix_pr intent)', () => {
    for (const name of SCENARIO_NAMES) {
      const types = REAL[name]!.steps.map((s) => s.type);
      expect(types.filter((t) => t === 'tool_call').length, `${name} tool_call`).toBeGreaterThanOrEqual(1);
      expect(types.filter((t) => t === 'tool_result').length, `${name} tool_result`).toBeGreaterThanOrEqual(1);
      expect(types.filter((t) => t === 'conclusion').length, `${name} conclusion`).toBe(1);
      const cfpr = REAL[name]!.steps.find((s) => s.type === 'tool_call' && s.tool_name === 'create_fix_pr');
      expect(cfpr, `${name} create_fix_pr intent`).toBeDefined();
    }
  });

  it('TC-18: each committed cache replays (offline/canned) to completed + propose_fix + a PR', async () => {
    for (const name of SCENARIO_NAMES) {
      const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
      const engine = new CachedEngine({ ...makeDeps(state), scenarios: REAL, sleep: NO_SLEEP, realPr: false, forceScenario: name });
      const { sink, prs } = makeSink();
      const res = await engine.investigate(makeIncident(), sink);
      expect(res.status, `${name} status`).toBe('completed');
      expect(res.decision, `${name} decision`).toBe('propose_fix');
      expect(prs.length, `${name} prCreated`).toBe(1);
      expect(state.prRows.length, `${name} pull_requests row`).toBe(1);
    }
  });

  it('TC-19: each recorded create_fix_pr intent is a revert of the seeded bad SHA', () => {
    const expectedSha: Record<ScenarioName, string> = {
      bad_deploy: '1faea629b497d3250927292cc69072c8c20008be',
      slow_db: '32a55d50246e401a6a8216a1f14a42930b1590bb',
      config_error: '4e677cc62a1d10254573814540ede80ac9be140e',
    };
    for (const name of SCENARIO_NAMES) {
      const cfpr = REAL[name]!.steps.find((s) => s.type === 'tool_call' && s.tool_name === 'create_fix_pr');
      const input = cfpr!.tool_input as { kind: string; revert_sha?: string };
      expect(input.kind, `${name} kind`).toBe('revert');
      expect(input.revert_sha, `${name} revert_sha`).toBe(expectedSha[name]);
    }
  });
});

/* ── D. Real-PR fallback (§13 / CACHE_REAL_PR) ───────────────────────────── */

describe('C8-D: real-PR fallback (§13/CACHE_REAL_PR) — real tool / Octokit-fail canned / disabled', () => {
  it('TC-20: cacheRealPr=true + healthy Octokit → executes the REAL create_fix_pr (fresh PR, not the canned one)', async () => {
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const engine = new CachedEngine({
      ...makeDeps(state, { cacheRealPr: true, revertResult: { number: 4242, url: 'https://github.com/DIVIJ08070/oncall-ai-victim/pull/4242' } }),
      scenarios: REAL,
      sleep: NO_SLEEP,
      forceScenario: 'bad_deploy',
    });
    const { sink, prs } = makeSink();
    const res = await engine.investigate(makeIncident(), sink);
    // real openRevertPr was called → the emitted PR is the FRESH one (#4242), not canned #6
    expect(state.revertCalls.length).toBe(1);
    expect((prs[0] as { number: number }).number).toBe(4242);
    expect(res.pr_number).toBe(4242);
    expect(res.status).toBe('completed');
    // real tool persisted the row + linked the incident fix_proposed
    expect(state.prRows.length).toBe(1);
    expect(state.incidentPatches.some((p) => p.status === 'fix_proposed')).toBe(true);
  });

  it('TC-21: cacheRealPr=true + Octokit THROWS → falls back to the canned recorded PR (#6), still persists + fires pr_created', async () => {
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const engine = new CachedEngine({
      ...makeDeps(state, { cacheRealPr: true, revertThrows: true }),
      scenarios: REAL,
      sleep: NO_SLEEP,
      forceScenario: 'bad_deploy',
    });
    const { sink, prs } = makeSink();
    const res = await engine.investigate(makeIncident(), sink);
    expect(state.revertCalls.length).toBe(1); // attempted the real write
    // fell back to the canned PR captured at record time (#6)
    expect((prs[0] as { number: number }).number).toBe(6);
    expect(res.pr_number).toBe(6);
    expect(res.status).toBe('completed'); // demo continues
    expect(state.prRows.length).toBe(1); // canned path persisted a row
  });

  it('TC-22: cacheRealPr=false → always canned; never touches Octokit', async () => {
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const engine = new CachedEngine({
      ...makeDeps(state, { cacheRealPr: false }),
      scenarios: REAL,
      sleep: NO_SLEEP,
      forceScenario: 'bad_deploy',
      realPr: false,
    });
    const { sink, prs } = makeSink();
    const res = await engine.investigate(makeIncident(), sink);
    expect(state.revertCalls.length).toBe(0); // never called the real write
    expect((prs[0] as { number: number }).number).toBe(6); // canned
    expect(res.status).toBe('completed');
  });

  it('TC-23: real-tool path still honors the FR-13 confidence gate (threshold above recorded confidence → refuse+escalate, no write)', async () => {
    // Recorded bad_deploy confidence is 0.97; set the gate to 0.99 → the REAL tool must refuse.
    const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
    const engine = new CachedEngine({
      ...makeDeps(state, { cacheRealPr: true, confidenceThreshold: 0.99 }),
      scenarios: REAL,
      sleep: NO_SLEEP,
      forceScenario: 'bad_deploy',
    });
    const { sink, prs } = makeSink();
    const res = await engine.investigate(makeIncident(), sink);
    expect(state.revertCalls.length).toBe(0); // FR-13 gate refused before any GitHub write
    expect(state.prRows.length).toBe(0); // no PR row persisted
    expect(res.status).toBe('escalated'); // engine escalates on refusal
    expect(prs.length).toBe(0);
  });
});

/* ── E. Engine factory (§9/§13) ──────────────────────────────────────────── */

describe('C8-E: createEngine factory selection (§9/§13)', () => {
  const state: FakeState = { prRows: [], incidentPatches: [], revertCalls: [] };
  const base = () => ({ ...makeDeps(state), cachedEngineFactory });

  it('TC-25: AGENT_MODE=cached + factory → CachedEngine', () => {
    const deps = base();
    deps.config.agent.mode = 'cached';
    expect(createEngine(deps)).toBeInstanceOf(CachedEngine);
  });

  it('TC-26: AGENT_MODE=auto + live unavailable → CachedEngine', () => {
    const deps = base();
    deps.config.agent.mode = 'auto';
    const engine = createEngine({ ...deps, isLiveAvailable: () => false });
    expect(engine).toBeInstanceOf(CachedEngine);
  });

  it('TC-27: AGENT_MODE=auto + live available → LiveClaudeEngine', () => {
    const deps = base();
    deps.config.agent.mode = 'auto';
    const engine = createEngine({ ...deps, isLiveAvailable: () => true });
    expect(engine).toBeInstanceOf(LiveClaudeEngine);
  });

  it('TC-28: AGENT_MODE=live → LiveClaudeEngine (even if live-probe would be false)', () => {
    const deps = base();
    deps.config.agent.mode = 'live';
    const engine = createEngine({ ...deps, isLiveAvailable: () => false });
    expect(engine).toBeInstanceOf(LiveClaudeEngine);
  });

  it('TC-29: AGENT_MODE=cached WITH factory does not throw (C8 wired)', () => {
    const deps = base();
    deps.config.agent.mode = 'cached';
    expect(() => createEngine(deps)).not.toThrow();
  });

  it('TC-29b: AGENT_MODE=cached WITHOUT factory throws a clear error (regression guard preserved)', () => {
    const deps = { ...makeDeps(state) };
    (deps as AgentEngineConfig extends never ? never : typeof deps & { config: AgentEngineConfig }).config.agent.mode = 'cached';
    expect(() => createEngine(deps as Parameters<typeof createEngine>[0])).toThrow(/CachedEngine is not available/);
  });
});
