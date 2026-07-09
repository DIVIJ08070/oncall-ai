import { describe, it, expect } from 'vitest';
import {
  LogEventInputSchema,
  IngestRequestSchema,
  IncidentStatusSchema,
  SearchLogsInputSchema,
  CreateFixPrInputSchema,
  GetDeployDiffInputSchema,
  FeedEventSchema,
  MetricsQuerySchema,
  AGENT_TOOL_NAMES,
} from '../src/index.js';

describe('@oncall/shared schemas', () => {
  it('accepts a valid ingest event and applies field rules', () => {
    const ev = LogEventInputSchema.parse({
      service: 'checkout-api',
      level: 'error',
      message: "Cannot read properties of undefined (reading 'name')",
    });
    expect(ev.service).toBe('checkout-api');
    // optional fields stay undefined, not defaulted
    expect(ev.status).toBeUndefined();
  });

  it('rejects an ingest event missing required fields', () => {
    const r = LogEventInputSchema.safeParse({ level: 'error', message: 'x' });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid log level', () => {
    const r = LogEventInputSchema.safeParse({
      service: 's',
      level: 'fatal',
      message: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('enforces the ingest batch cap of 500', () => {
    const events = Array.from({ length: 501 }, () => ({
      service: 's',
      level: 'info' as const,
      message: 'm',
    }));
    expect(IngestRequestSchema.safeParse({ events }).success).toBe(false);
  });

  it('defaults search_logs.limit to 30 and caps at 50', () => {
    expect(SearchLogsInputSchema.parse({}).limit).toBe(30);
    expect(SearchLogsInputSchema.safeParse({ limit: 51 }).success).toBe(false);
  });

  it('coerces metrics query params and applies defaults', () => {
    const q = MetricsQuerySchema.parse({ service: 'checkout-api' });
    expect(q.window_sec).toBe(900);
    expect(q.resolution_sec).toBe(15);
  });

  it('requires revert_sha for kind=revert and files for kind=patch', () => {
    expect(
      CreateFixPrInputSchema.safeParse({
        kind: 'revert',
        confidence: 0.9,
        root_cause: 'rc',
        title: 't',
        body: 'b',
      }).success,
    ).toBe(false);
    expect(
      CreateFixPrInputSchema.safeParse({
        kind: 'revert',
        confidence: 0.9,
        root_cause: 'rc',
        title: 't',
        body: 'b',
        revert_sha: 'abc1234',
      }).success,
    ).toBe(true);
    expect(
      CreateFixPrInputSchema.safeParse({
        kind: 'patch',
        confidence: 0.9,
        root_cause: 'rc',
        title: 't',
        body: 'b',
        files: [],
      }).success,
    ).toBe(false);
  });

  it('accepts both shapes of get_deploy_diff input', () => {
    expect(GetDeployDiffInputSchema.safeParse({ sha: 'abc' }).success).toBe(true);
    expect(
      GetDeployDiffInputSchema.safeParse({ base: 'a', head: 'b' }).success,
    ).toBe(true);
    expect(GetDeployDiffInputSchema.safeParse({}).success).toBe(false);
  });

  it('discriminates feed events by `event`', () => {
    const parsed = FeedEventSchema.parse({
      event: 'conclusion',
      data: { root_cause: 'null deref', confidence: 0.92, decision: 'propose_fix' },
    });
    expect(parsed.event).toBe('conclusion');
  });

  it('enumerates the incident lifecycle states', () => {
    expect(IncidentStatusSchema.options).toContain('awaiting_merge');
    expect(IncidentStatusSchema.options).toContain('resolved');
  });

  it('exposes exactly the 7 allowlisted tool names', () => {
    expect(AGENT_TOOL_NAMES).toHaveLength(7);
    expect(AGENT_TOOL_NAMES).toContain('create_fix_pr');
    expect(AGENT_TOOL_NAMES).toContain('submit_findings');
  });
});
