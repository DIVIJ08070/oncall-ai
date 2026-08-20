import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import {
  ServicesResponseSchema,
  MetricsResponseSchema,
  LogsResponseSchema,
  IncidentsListResponseSchema,
  IncidentDetailResponseSchema,
  ChatResponseSchema,
  PostmortemResponseSchema,
  InvestigateResponseSchema,
  SessionStartedDataSchema,
  ConclusionDataSchema,
  SessionCompletedDataSchema,
  PrCreatedDataSchema,
  StepSchema,
  type Incident,
} from '@oncall/shared';
import { openMemoryDatabase, type OncallDb } from '../src/db/index.js';
import { loadConfig, type Config } from '../src/config.js';
import { createBroker, feedTopic, type Broker } from '../src/sse/broker.js';
import { buildApp } from '../src/app.js';
import { createInvestigationService, type EngineFactory } from '../src/investigation/service.js';
import { createSlackNotifier } from '../src/notify/index.js';

/**
 * QA C10 — INDEPENDENT spec-derived contract suite (SPEC §7.2/§7.2b/§7.3/§7.4/§7.8).
 * Derived from SPEC §7 BEFORE reading the impl (see TEST_CASES-C10.md). Verifies the
 * EXACT response DTO/shape/status/framing per route — not copied from the dev's suite.
 */

const KEY = 'qa-c10-key';

interface Harness {
  app: FastifyInstance;
  db: OncallDb;
  config: Config;
  broker: Broker;
  customerId: string;
}

/** Fake engine that fully populates the PR row (branch/base/head_sha) + findings. */
const fakeEngine: EngineFactory = (deps) => ({
  async investigate(incident, sink) {
    const session = deps.sessions.create({
      incident_id: incident.id,
      mode: 'live',
      model: 'claude-sonnet-5',
      started_at: Date.now(),
    });
    const emit = (m: {
      type: 'thought' | 'tool_call' | 'tool_result' | 'conclusion' | 'error';
      tool_name?: string;
      tool_input?: unknown;
      tool_output?: unknown;
      content?: string;
    }): void => {
      const a = deps.steps.append({ session_id: session.id, ...m });
      const now = Date.now();
      void sink.step?.({
        session_id: session.id,
        seq: a.seq,
        type: m.type,
        tool_name: m.tool_name ?? null,
        tool_input: m.tool_input ?? null,
        tool_output: m.tool_output ?? null,
        content: m.content ?? null,
        created_at: now,
        ts: now,
      });
    };
    emit({ type: 'thought', content: 'Looking at the spike.' });
    emit({ type: 'tool_call', tool_name: 'get_recent_deploys', tool_input: {} });
    emit({ type: 'tool_result', tool_name: 'get_recent_deploys', tool_output: { deploys: [] } });
    const pr = deps.db.dao.pullRequests.create({
      incident_id: incident.id,
      customer_id: incident.customer_id,
      github_pr_number: 7,
      github_pr_id: 700,
      branch: 'oncall-ai/fix-inc_x-a1b2c3',
      base_branch: 'main',
      title: 'Revert bad deploy',
      url: 'https://github.com/DIVIJ08070/oncall-ai-victim/pull/7',
      kind: 'revert',
      diagnostic_report: '## Root Cause\nNull deref',
      head_sha: 'def5678abcd',
    });
    deps.db.dao.incidents.update(incident.id, {
      status: 'fix_proposed',
      pr_id: pr.id,
      root_cause: 'Null deref introduced by deploy abc1234',
      confidence: 0.92,
      suspect_deploy_sha: 'abc1234def',
    });
    void sink.prCreated?.({ number: 7, url: pr.url, kind: 'revert' });
    emit({ type: 'conclusion', content: 'Proposing a revert.' });
    void sink.conclusion?.({
      root_cause: 'Null deref introduced by deploy abc1234',
      confidence: 0.92,
      decision: 'propose_fix',
    });
    deps.sessions.finish(session.id, {
      status: 'completed',
      root_cause: 'Null deref introduced by deploy abc1234',
      confidence: 0.92,
      decision: 'propose_fix',
      iterations: 4,
      cost_usd: 0.06,
      completed_at: Date.now(),
    });
    return {
      session_id: session.id,
      status: 'completed',
      mode: 'live',
      model: 'claude-sonnet-5',
      iterations: 4,
      root_cause: 'Null deref introduced by deploy abc1234',
      confidence: 0.92,
      decision: 'propose_fix',
      cost_usd: 0.06,
      pr_number: 7,
      pr_url: pr.url,
    };
  },
});

async function harness(overrides: Record<string, string> = {}): Promise<Harness> {
  const db = openMemoryDatabase();
  const config = loadConfig({
    INGEST_API_KEY: KEY,
    DEV_NO_AUTH: 'true',
    GITHUB_TOKEN: '',
    DATABASE_URL: ':memory:',
    ...overrides,
  });
  const customer = db.dao.customers.create({
    name: 'demo',
    ingest_api_key: KEY,
    github_owner: config.github.owner,
    github_repo: config.github.repo,
    default_branch: config.github.defaultBranch,
  });
  const broker = createBroker();
  const investigation = createInvestigationService({ db, config, broker, engineFactory: fakeEngine });
  const app = await buildApp({ db, config, broker, investigation });
  openApps.push(app);
  return { app, db, config, broker, customerId: customer.id };
}

function seedService(h: Harness, service = 'checkout-api', ts = Date.now()): void {
  h.db.dao.services.touch(h.customerId, service, ts);
  h.db.dao.metricSamples.insert({
    customer_id: h.customerId, service, bucket_ts: ts, window_sec: 60,
    request_count: 40, error_count: 0, error_rate: 0, p50_ms: 30, p95_ms: 120, p99_ms: 200,
  });
}

function seedIncident(h: Harness, service = 'checkout-api', fp = 'fp-1'): Incident {
  return h.db.dao.incidents.openOrDedup({
    customer_id: h.customerId, service, detector: 'error_rate', fingerprint: fp,
    title: `Error-rate spike on ${service}`, severity: 'high',
    threshold_value: 0.2, observed_value: 0.87,
  }).incident;
}

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of openApps.splice(0)) await a.close();
});

async function collectSse(url: string, until: (t: string) => boolean, timeoutMs = 3000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text = '';
  try {
    const res = await fetch(url, { signal: controller.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (until(text)) { controller.abort(); break; }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
  } finally { clearTimeout(timer); }
  return text;
}
function frames(text: string): { event: string; data: unknown }[] {
  const out: { event: string; data: unknown }[] = [];
  for (const block of text.split('\n\n')) {
    const ev = block.split('\n').find((l) => l.startsWith('event: '));
    const dt = block.split('\n').find((l) => l.startsWith('data: '));
    if (ev && dt) out.push({ event: ev.slice(7), data: JSON.parse(dt.slice(6)) });
  }
  return out;
}
async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

/* ── §7.2 services ────────────────────────────────────────────────────────── */
describe('QA C10 §7.2 GET /services', () => {
  it('TC-01/02/03 exact ServiceHealth DTO + health enum + active_incident_id', async () => {
    const h = await harness();
    seedService(h);
    const inc = seedIncident(h);
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/services' });
    expect(res.statusCode).toBe(200);
    const body = ServicesResponseSchema.parse(res.json());
    const svc = body.services.find((s) => s.name === 'checkout-api')!;
    expect(svc).toBeDefined();
    expect(['healthy', 'degraded', 'down', 'silent']).toContain(svc.health);
    expect(new Set(Object.keys(svc))).toEqual(
      new Set(['name', 'health', 'error_rate', 'p95_ms', 'req_per_min', 'last_event_at', 'active_incident_id']),
    );
    expect(svc.active_incident_id).toBe(inc.id);
  });
  it('TC-04 empty state', async () => {
    const h = await harness();
    const body = ServicesResponseSchema.parse((await h.app.inject({ method: 'GET', url: '/api/v1/services' })).json());
    expect(body.services).toEqual([]);
  });
});

/* ── §7.2 metrics ─────────────────────────────────────────────────────────── */
describe('QA C10 §7.2 GET /metrics', () => {
  it('TC-05/09 snapshot shape + defaults (window 900)', async () => {
    const h = await harness();
    seedService(h);
    const body = MetricsResponseSchema.parse(
      (await h.app.inject({ method: 'GET', url: '/api/v1/metrics?service=checkout-api' })).json(),
    );
    expect(body.service).toBe('checkout-api');
    expect(body.window_sec).toBe(900);
    expect(new Set(Object.keys(body.current))).toEqual(
      new Set(['error_rate', 'req_count', 'p50_ms', 'p95_ms', 'p99_ms']),
    );
    expect(new Set(Object.keys(body.baseline))).toEqual(new Set(['error_rate', 'p95_ms']));
  });
  it('TC-06 series capped ≤ 240', async () => {
    const h = await harness();
    const base = Date.now() - 300 * 1000;
    for (let i = 0; i < 250; i++) {
      h.db.dao.services.touch(h.customerId, 'svc', base + i * 1000);
      h.db.dao.metricSamples.insert({
        customer_id: h.customerId, service: 'svc', bucket_ts: base + i * 1000, window_sec: 60,
        request_count: 5, error_count: 0, error_rate: 0, p50_ms: 10, p95_ms: 20, p99_ms: 30,
      });
    }
    const body = MetricsResponseSchema.parse(
      (await h.app.inject({ method: 'GET', url: '/api/v1/metrics?service=svc&window_sec=3600' })).json(),
    );
    expect(body.series.length).toBeLessThanOrEqual(240);
  });
  it('TC-07 unknown service → 404 not_found', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/metrics?service=ghost' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
  it('TC-08 missing service → 400 validation_error', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/metrics' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});

/* ── §7.2b logs ───────────────────────────────────────────────────────────── */
describe('QA C10 §7.2b GET /logs', () => {
  it('TC-10/12/13 events (no customer_id) + filter + cursor', async () => {
    const h = await harness();
    const now = Date.now();
    for (let i = 0; i < 4; i++)
      h.db.dao.logEvents.insert({ customer_id: h.customerId, service: 'checkout-api', level: i === 0 ? 'info' : 'error', message: `m${i}`, timestamp: now - i * 1000 });
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/logs?service=checkout-api&level=error&limit=2' });
    const body = LogsResponseSchema.parse(res.json());
    expect(body.events).toHaveLength(2);
    expect(body.events.every((e) => e.level === 'error')).toBe(true);
    expect((body.events[0] as Record<string, unknown>).customer_id).toBeUndefined();
    expect(body.next_before).not.toBeNull();
  });
  it('TC-11 limit > 500 rejected (contract limit ≤ 500)', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/logs?limit=999' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});

/* ── §7.3 incidents ───────────────────────────────────────────────────────── */
describe('QA C10 §7.3 incidents list + detail', () => {
  it('TC-17/18 list shape + status filter', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    const list = IncidentsListResponseSchema.parse((await h.app.inject({ method: 'GET', url: '/api/v1/incidents' })).json());
    expect(list.incidents).toHaveLength(1);
    expect(list.incidents[0].id).toBe(inc.id);
    h.db.dao.incidents.update(inc.id, { status: 'resolved', resolved_at: Date.now() });
    const open = IncidentsListResponseSchema.parse((await h.app.inject({ method: 'GET', url: '/api/v1/incidents?status=open' })).json());
    expect(open.incidents).toHaveLength(0);
  });
  it('TC-20/21/22/23/25 full detail DTO (incident/session/steps/timeline)', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/investigate` });
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/incidents/${inc.id}` });
    const d = IncidentDetailResponseSchema.parse(res.json());
    expect(new Set(Object.keys(d))).toEqual(new Set(['incident', 'session', 'steps', 'pull_request', 'timeline']));
    for (const k of ['id', 'service', 'status', 'detector', 'title', 'fingerprint', 'observed_value', 'threshold_value', 'opened_at', 'first_error_at', 'resolved_at', 'root_cause', 'confidence'])
      expect(d.incident).toHaveProperty(k);
    for (const k of ['id', 'status', 'mode', 'model', 'iterations', 'cost_usd', 'root_cause', 'confidence'])
      expect(d.session).toHaveProperty(k);
    expect(d.steps.length).toBeGreaterThanOrEqual(4);
    for (const s of d.steps) StepSchema.parse(s);
    const seqs = d.steps.map((s) => s.seq);
    expect([...seqs]).toEqual([...seqs].sort((a, b) => a - b));
    const kinds = new Set(['detected', 'investigating', 'pr_opened', 'merged', 'verifying', 'resolved', 'escalated']);
    for (const t of d.timeline) expect(kinds.has(t.kind)).toBe(true);
    expect(d.timeline.map((t) => t.kind)).toContain('pr_opened');
  });
  it('TC-24 pull_request DTO exposes branch/base/head_sha (SPEC §7.3) — CONTRACT CHECK', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/investigate` });
    const d = IncidentDetailResponseSchema.parse((await h.app.inject({ method: 'GET', url: `/api/v1/incidents/${inc.id}` })).json());
    const pr = d.pull_request as Record<string, unknown> | null;
    expect(pr).not.toBeNull();
    // SPEC §7.3 pull_request DTO = number,url,kind,state,verification_status,branch,base,head_sha (8 fields)
    expect(new Set(Object.keys(pr as object))).toEqual(
      new Set(['number', 'url', 'kind', 'state', 'verification_status', 'branch', 'base', 'head_sha']),
    );
    // BUG-009 (fixed 602f44d): the 3 formerly-omitted fields are now on the wire with correct values.
    // Row seeds branch/base_branch/head_sha; the wire must map base_branch -> base.
    expect(pr).toMatchObject({
      number: 7,
      kind: 'revert',
      branch: 'oncall-ai/fix-inc_x-a1b2c3',
      base: 'main', // row.base_branch:'main' mapped to wire `base`
      head_sha: 'def5678abcd',
    });
  });
  it('TC-26 unknown id → 404', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/incidents/inc_nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
  it('TC-27 incident without session/PR → nullable, not 500', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    const d = IncidentDetailResponseSchema.parse((await h.app.inject({ method: 'GET', url: `/api/v1/incidents/${inc.id}` })).json());
    expect(d.session).toBeNull();
    expect(d.pull_request).toBeNull();
    expect(d.steps).toEqual([]);
  });
});

/* ── §7.3 investigate ─────────────────────────────────────────────────────── */
describe('QA C10 §7.3 POST /incidents/:id/investigate', () => {
  it('TC-28 202 + ses_ id + persisted', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/investigate` });
    expect(res.statusCode).toBe(202);
    const body = InvestigateResponseSchema.parse(res.json());
    expect(body.session_id).toMatch(/^ses_/);
    expect(h.db.dao.sessions.getById(body.session_id)?.status).toBe('completed');
  });
  it('TC-29 unknown incident → 404', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/incidents/nope/investigate' });
    expect(res.statusCode).toBe(404);
  });
});

/* ── §7.3 feed SSE ────────────────────────────────────────────────────────── */
describe('QA C10 §7.3 GET /incidents/:id/feed (SSE)', () => {
  it('TC-30..34 exact framing + payloads; TC-35/36 replay-then-live + seq-dedup', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    // Persist a completed session with two steps (the already-happened part).
    const session = h.db.dao.sessions.create({ incident_id: inc.id, mode: 'live', model: 'claude-sonnet-5' });
    h.db.dao.steps.append({ session_id: session.id, type: 'thought', content: 's0', seq: 0 });
    h.db.dao.steps.append({ session_id: session.id, type: 'thought', content: 's1', seq: 1 });
    h.db.dao.sessions.finish(session.id, { status: 'completed', iterations: 2, cost_usd: 0.01, completed_at: Date.now() });
    const base = await listen(h.app);
    const text = collectSse(`${base}/api/v1/incidents/${inc.id}/feed`, (t) => t.includes('"sentinel"'));
    await new Promise((r) => setTimeout(r, 100));
    // Replayed seq 0 → must be DROPPED; seq 5 → must PASS.
    h.broker.publish(feedTopic(inc.id), { event: 'step', data: { seq: 0, type: 'thought', content: 's0' } });
    h.broker.publish(feedTopic(inc.id), { event: 'step', data: { seq: 5, type: 'thought', content: 'sentinel' } });
    const fr = frames(await text);

    const started = fr.find((f) => f.event === 'session_started')!;
    SessionStartedDataSchema.parse(started.data);
    const replay = fr.find((f) => f.event === 'replay')!;
    expect((replay.data as { steps: unknown[] }).steps).toHaveLength(2);
    // session_started precedes replay (SPEC §7.3 replay-then-live ordering).
    expect(fr.map((f) => f.event).indexOf('session_started')).toBeLessThan(fr.map((f) => f.event).indexOf('replay'));
    const completed = fr.find((f) => f.event === 'session_completed');
    if (completed) SessionCompletedDataSchema.parse(completed.data);
    // seq-dedup: only the newer live step (seq 5) survives.
    const steps = fr.filter((f) => f.event === 'step');
    expect(steps).toHaveLength(1);
    expect((steps[0].data as { content: string }).content).toBe('sentinel');
  });
  it('TC-31/33/34 live control-frame payloads match SPEC §7.3', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    const base = await listen(h.app);
    const text = collectSse(`${base}/api/v1/incidents/${inc.id}/feed`, (t) => t.includes('session_completed'), 3000);
    await new Promise((r) => setTimeout(r, 100));
    await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/investigate` });
    const fr = frames(await text);
    SessionStartedDataSchema.parse(fr.find((f) => f.event === 'session_started')!.data);
    PrCreatedDataSchema.parse(fr.find((f) => f.event === 'pr_created')!.data);
    ConclusionDataSchema.parse(fr.find((f) => f.event === 'conclusion')!.data);
    SessionCompletedDataSchema.parse(fr.find((f) => f.event === 'session_completed')!.data);
  });
});

/* ── §7.4 chat + postmortem ───────────────────────────────────────────────── */
describe('QA C10 §7.4 chat + postmortem', () => {
  it('TC-37/38/41 chat DTO {role,content,evidence[{type,tool,ref}]} + persist', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/investigate` });
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/chat`, payload: { message: 'Why?' } });
    expect(res.statusCode).toBe(200);
    const body = ChatResponseSchema.parse(res.json());
    expect(body.message.role).toBe('assistant');
    expect(body.message.content).toContain('Null deref');
    const ev = body.message.evidence ?? [];
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) expect(e).toHaveProperty('type');
    expect(h.db.dao.chatMessages.listByIncident(inc.id)).toHaveLength(2);
  });
  it('TC-39 empty message → 400', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/chat`, payload: { message: '' } });
    expect(res.statusCode).toBe(400);
  });
  it('TC-40 unknown incident → 404', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/incidents/nope/chat', payload: { message: 'x' } });
    expect(res.statusCode).toBe(404);
  });
  it('TC-42 chat/stream token then done', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/investigate` });
    const base = await listen(h.app);
    const fr = frames(await collectSse(`${base}/api/v1/incidents/${inc.id}/chat/stream?message=why`, (t) => t.includes('event: done')));
    expect(fr.some((f) => f.event === 'token')).toBe(true);
    expect(fr.find((f) => f.event === 'done')).toBeDefined();
  });
  it('TC-43/44 POST postmortem 201 + stored; GET returns it', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/investigate` });
    const post = await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/postmortem` });
    expect(post.statusCode).toBe(201);
    const body = PostmortemResponseSchema.parse(post.json());
    expect(body.postmortem).toContain('# Postmortem');
    const get = await h.app.inject({ method: 'GET', url: `/api/v1/incidents/${inc.id}/postmortem` });
    expect(get.statusCode).toBe(200);
    expect(PostmortemResponseSchema.parse(get.json()).postmortem).toBe(body.postmortem);
    expect(h.db.dao.incidents.getById(inc.id)?.postmortem).toBe(body.postmortem);
  });
  it('TC-45 GET postmortem before generate → 404', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/incidents/${inc.id}/postmortem` });
    expect(res.statusCode).toBe(404);
  });
  it('TC-46 POST postmortem unknown → 404', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/incidents/nope/postmortem' });
    expect(res.statusCode).toBe(404);
  });
});

/* ── §7.8 health + FR-17 Slack stub + auth ────────────────────────────────── */
describe('QA C10 §7.8 health + FR-17 notifications + auth', () => {
  it('TC-47 GET /health → {status:"ok"}', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
  it('TC-48 FR-17 Slack stub records a notifications row (empty webhook → stubbed)', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    const notifier = createSlackNotifier({ db: h.db, config: h.config });
    await notifier.incidentOpened(inc);
    const rows = h.db.dao.notifications.listByIncident(inc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe('slack');
    expect(rows[0].status).toBe('stubbed');
  });
  it('TC-50 error envelope shape {error:{code,message}}', async () => {
    const h = await harness();
    const body = (await h.app.inject({ method: 'GET', url: '/api/v1/incidents/inc_nope' })).json();
    expect(body).toHaveProperty('error.code');
    expect(body).toHaveProperty('error.message');
  });
  it('AUTH read APIs 401 when DEV_NO_AUTH=false and no session', async () => {
    const h = await harness({ DEV_NO_AUTH: 'false', SESSION_SECRET: 'x'.repeat(32) });
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/services' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });
});
