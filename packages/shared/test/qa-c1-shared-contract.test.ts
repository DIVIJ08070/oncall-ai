/**
 * QA C1 — independent contract tests for @oncall/shared.
 * Derived from SPEC §3/§7/§8/§9 BEFORE reading the implementation (see
 * features/oncall-ai/qa/TEST_CASES-C1.md). Imports the BUILT package via its
 * `exports` map (barrel + `./tools` subpath) — the real shipped resolution,
 * not the `../src` path the dev tests use.
 */
import { describe, it, expect } from 'vitest';
import * as shared from '@oncall/shared';
import * as toolsSubpath from '@oncall/shared/tools';

const isZodSchema = (x: unknown): boolean =>
  !!x && typeof (x as { parse?: unknown }).parse === 'function' &&
  typeof (x as { safeParse?: unknown }).safeParse === 'function';

describe('TC-03/04 module resolution via exports map', () => {
  it('TC-03 barrel (@oncall/shared) resolves and re-exports all domains', () => {
    expect(isZodSchema(shared.LogEventSchema)).toBe(true);
    expect(isZodSchema(shared.MetricsSnapshotSchema)).toBe(true);
    expect(isZodSchema(shared.IncidentSchema)).toBe(true);
    expect(isZodSchema(shared.PullRequestRecSchema)).toBe(true);
    expect(isZodSchema(shared.SessionSchema)).toBe(true);
    expect(isZodSchema(shared.SearchLogsInputSchema)).toBe(true);
    expect(isZodSchema(shared.IngestRequestSchema)).toBe(true);
    expect(isZodSchema(shared.FeedEventSchema)).toBe(true);
  });

  it('TC-04 ./tools subpath resolves and exposes the tool schemas', () => {
    expect(isZodSchema(toolsSubpath.SearchLogsInputSchema)).toBe(true);
    expect(isZodSchema(toolsSubpath.CreateFixPrInputSchema)).toBe(true);
    expect(isZodSchema(toolsSubpath.SubmitFindingsInputSchema)).toBe(true);
    expect(Array.isArray(toolsSubpath.AGENT_TOOL_NAMES)).toBe(true);
  });
});

describe('TC-05..12 all 8 domain modules present as zod schemas', () => {
  it('TC-05 log.ts — LogEvent + LogLevel', () => {
    expect(isZodSchema(shared.LogEventSchema)).toBe(true);
    expect(isZodSchema(shared.LogLevelSchema)).toBe(true);
  });
  it('TC-06 metrics.ts — MetricSample + MetricsSnapshot', () => {
    expect(isZodSchema(shared.MetricSampleSchema)).toBe(true);
    expect(isZodSchema(shared.MetricsSnapshotSchema)).toBe(true);
  });
  it('TC-07 incident.ts — Incident + IncidentStatus + Detector + Fingerprint', () => {
    expect(isZodSchema(shared.IncidentSchema)).toBe(true);
    expect(isZodSchema(shared.IncidentStatusSchema)).toBe(true);
    expect(isZodSchema(shared.DetectorSchema)).toBe(true);
    expect(isZodSchema(shared.FingerprintSchema)).toBe(true);
  });
  it('TC-08 github.ts — DeployRef + PullRequestRec', () => {
    expect(isZodSchema(shared.DeployRefSchema)).toBe(true);
    expect(isZodSchema(shared.PullRequestRecSchema)).toBe(true);
  });
  it('TC-09 investigation.ts — Session + Step + StepType + Confidence', () => {
    expect(isZodSchema(shared.SessionSchema)).toBe(true);
    expect(isZodSchema(shared.StepSchema)).toBe(true);
    expect(isZodSchema(shared.StepTypeSchema)).toBe(true);
    expect(isZodSchema(shared.ConfidenceSchema)).toBe(true);
  });
  it('TC-10 tools.ts — 6 tool I/O schemas + submit_findings', () => {
    for (const s of [
      shared.SearchLogsInputSchema,
      shared.GetMetricsInputSchema,
      shared.GetRecentDeploysInputSchema,
      shared.GetDeployDiffInputSchema,
      shared.ReadFileInputSchema,
      shared.CreateFixPrInputSchema,
      shared.SubmitFindingsInputSchema,
    ]) {
      expect(isZodSchema(s)).toBe(true);
    }
    expect(shared.AGENT_TOOL_NAMES).toEqual([
      'search_logs',
      'get_metrics',
      'get_recent_deploys',
      'get_deploy_diff',
      'read_file',
      'create_fix_pr',
      'submit_findings',
    ]);
  });
  it('TC-11 api.ts — request/response DTOs for routes (§7)', () => {
    for (const s of [
      shared.IngestRequestSchema,
      shared.IngestResponseSchema,
      shared.ServicesResponseSchema,
      shared.MetricsResponseSchema,
      shared.IncidentsListResponseSchema,
      shared.IncidentDetailResponseSchema,
      shared.ApiErrorSchema,
    ]) {
      expect(isZodSchema(s)).toBe(true);
    }
  });
  it('TC-12 sse.ts — SSE event union types', () => {
    expect(isZodSchema(shared.LogStreamEventSchema)).toBe(true);
    expect(isZodSchema(shared.FeedEventSchema)).toBe(true);
    expect(isZodSchema(shared.ChatStreamEventSchema)).toBe(true);
    expect(shared.SSE_EVENT_NAMES).toEqual(
      expect.arrayContaining([
        'log', 'heartbeat', 'replay', 'session_started', 'step',
        'pr_created', 'conclusion', 'session_completed', 'error', 'token', 'done',
      ]),
    );
  });
});

describe('TC-13..18 enum & required-field contracts (§7/§8)', () => {
  it('TC-13 LogLevel enum = debug|info|warn|error', () => {
    for (const l of ['debug', 'info', 'warn', 'error']) {
      expect(shared.LogLevelSchema.safeParse(l).success).toBe(true);
    }
    expect(shared.LogLevelSchema.safeParse('trace').success).toBe(false);
    expect(shared.LogLevelSchema.safeParse('fatal').success).toBe(false);
  });
  it('TC-14 LogEventInput requires service/level/message; others optional/nullable', () => {
    expect(
      shared.LogEventInputSchema.safeParse({
        service: 'checkout-api', level: 'error', message: 'boom',
      }).success,
    ).toBe(true);
    // missing message
    expect(
      shared.LogEventInputSchema.safeParse({ service: 'x', level: 'error' }).success,
    ).toBe(false);
    // missing service
    expect(
      shared.LogEventInputSchema.safeParse({ level: 'error', message: 'boom' }).success,
    ).toBe(false);
    // nullable extras accepted
    expect(
      shared.LogEventInputSchema.safeParse({
        service: 'x', level: 'info', message: 'ok',
        stack: null, endpoint: null, method: null, status: null, latency_ms: null,
      }).success,
    ).toBe(true);
  });
  it('TC-15 Detector ∈ error_rate|latency|silence', () => {
    for (const d of ['error_rate', 'latency', 'silence']) {
      expect(shared.DetectorSchema.safeParse(d).success).toBe(true);
    }
    expect(shared.DetectorSchema.safeParse('cpu').success).toBe(false);
  });
  it('TC-16 IncidentStatus state-machine values (§8)', () => {
    for (const s of [
      'open', 'investigating', 'fix_proposed', 'escalated',
      'awaiting_merge', 'verifying', 'resolved', 'closed',
    ]) {
      expect(shared.IncidentStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(shared.IncidentStatusSchema.safeParse('bogus').success).toBe(false);
  });
  it('TC-17 StepType ∈ thought|tool_call|tool_result|conclusion|error', () => {
    for (const t of ['thought', 'tool_call', 'tool_result', 'conclusion', 'error']) {
      expect(shared.StepTypeSchema.safeParse(t).success).toBe(true);
    }
    expect(shared.StepTypeSchema.safeParse('reasoning').success).toBe(false);
  });
  it('TC-18 SessionStatus ∈ running|completed|escalated|failed; SessionMode ∈ live|cached', () => {
    for (const s of ['running', 'completed', 'escalated', 'failed']) {
      expect(shared.SessionStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(shared.SessionStatusSchema.safeParse('paused').success).toBe(false);
    for (const m of ['live', 'cached']) {
      expect(shared.SessionModeSchema.safeParse(m).success).toBe(true);
    }
    expect(shared.SessionModeSchema.safeParse('hybrid').success).toBe(false);
  });
});

describe('TC-19..23 tool I/O caps & shapes (§9)', () => {
  it('TC-19 search_logs.limit ≤ 50 (default 30)', () => {
    expect(shared.SearchLogsInputSchema.parse({}).limit).toBe(30);
    expect(shared.SearchLogsInputSchema.safeParse({ limit: 30 }).success).toBe(true);
    expect(shared.SearchLogsInputSchema.safeParse({ limit: 99 }).success).toBe(false);
  });
  it('TC-20 get_metrics.window_sec ≤ 3600 (default 900)', () => {
    expect(shared.GetMetricsInputSchema.parse({ service: 'x' }).window_sec).toBe(900);
    expect(shared.GetMetricsInputSchema.safeParse({ service: 'x', window_sec: 900 }).success).toBe(true);
    expect(shared.GetMetricsInputSchema.safeParse({ service: 'x', window_sec: 99999 }).success).toBe(false);
  });
  it('TC-21 get_recent_deploys.limit ≤ 20 (default 10)', () => {
    expect(shared.GetRecentDeploysInputSchema.parse({}).limit).toBe(10);
    expect(shared.GetRecentDeploysInputSchema.safeParse({ limit: 20 }).success).toBe(true);
    expect(shared.GetRecentDeploysInputSchema.safeParse({ limit: 50 }).success).toBe(false);
  });
  it('TC-22 create_fix_pr: kind∈revert|patch, required fields, revert needs revert_sha', () => {
    const validRevert = {
      kind: 'revert', confidence: 0.9, root_cause: 'null deref',
      title: 'Revert bad deploy', body: '## report', revert_sha: 'abc1234',
    };
    expect(shared.CreateFixPrInputSchema.safeParse(validRevert).success).toBe(true);
    // kind=merge is not allowed (only revert|patch)
    expect(
      shared.CreateFixPrInputSchema.safeParse({ ...validRevert, kind: 'merge' }).success,
    ).toBe(false);
    // revert without revert_sha rejected
    const { revert_sha: _omit, ...noSha } = validRevert;
    expect(shared.CreateFixPrInputSchema.safeParse(noSha).success).toBe(false);
    // patch without files rejected
    expect(
      shared.CreateFixPrInputSchema.safeParse({
        kind: 'patch', confidence: 0.9, root_cause: 'x', title: 't', body: 'b',
      }).success,
    ).toBe(false);
  });
  it('TC-23 submit_findings: decision∈propose_fix|escalate, confidence 0..1', () => {
    const valid = {
      root_cause: 'null deref', evidence: [{ type: 'tool', ref: 'abc1234' }],
      confidence: 0.92, decision: 'propose_fix',
    };
    expect(shared.SubmitFindingsInputSchema.safeParse(valid).success).toBe(true);
    expect(
      shared.SubmitFindingsInputSchema.safeParse({ ...valid, decision: 'ship_it' }).success,
    ).toBe(false);
    // confidence out of [0,1] rejected (Confidence = z.number().min(0).max(1))
    expect(
      shared.SubmitFindingsInputSchema.safeParse({ ...valid, confidence: 1.5 }).success,
    ).toBe(false);
  });
});

describe('TC-24 single-source (z.infer) round-trip', () => {
  it('a valid Incident round-trips through its schema unchanged', () => {
    const inc = {
      id: 'inc_1', customer_id: 'cus_1', service: 'checkout-api',
      detector: 'error_rate', fingerprint: 'fp', title: 'spike',
      status: 'open', severity: 'high', threshold_value: 0.2, observed_value: 0.87,
      first_error_at: 1752, detected_at: 1752, opened_at: 1752,
      root_cause: null, confidence: null, pr_id: null, suspect_deploy_sha: null,
      resolved_at: null, postmortem: null, updated_at: 1752,
    };
    expect(shared.IncidentSchema.parse(inc)).toEqual(inc);
  });
  it('IngestRequest enforces 1..500 events (§7.1 batch cap)', () => {
    expect(shared.IngestRequestSchema.safeParse({ events: [] }).success).toBe(false);
    const one = { service: 'x', level: 'info', message: 'm' };
    expect(shared.IngestRequestSchema.safeParse({ events: [one] }).success).toBe(true);
    const many = Array.from({ length: 501 }, () => one);
    expect(shared.IngestRequestSchema.safeParse({ events: many }).success).toBe(false);
  });
});
