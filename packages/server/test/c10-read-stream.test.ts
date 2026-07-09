import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import {
  IncidentDetailResponseSchema,
  IncidentsListResponseSchema,
  LogsResponseSchema,
  MetricsResponseSchema,
  ServicesResponseSchema,
  ChatResponseSchema,
  PostmortemResponseSchema,
  InvestigateResponseSchema,
  FeedEventSchema,
  type Incident,
} from '@oncall/shared';
import { openMemoryDatabase, type OncallDb } from '../src/db/index.js';
import { loadConfig, type Config } from '../src/config.js';
import { createBroker, feedTopic, logsTopic, type Broker } from '../src/sse/broker.js';
import { buildApp } from '../src/app.js';
import {
  createInvestigationService,
  type EngineFactory,
} from '../src/investigation/service.js';
import { createDetectionEngine } from '../src/detection/index.js';
import { ManualClock } from '../src/detection/clock.js';
import { writeBatch } from '../src/ingest/writer.js';
import { formatSseComment, formatSseEvent } from '../src/sse/sse-reply.js';

/**
 * C10 — read/stream API surface (SPEC §7.2/§7.2b/§7.3/§7.4). Spec-derived
 * `.inject()` coverage for every route, SSE framing + replay-then-live via a real
 * listen socket, and an end-to-end integration: ingest → detection opens an
 * incident → the investigation session + steps persist and stream → the detail
 * DTO is complete.
 */

const KEY = 'test-ingest-key';

interface Harness {
  app: FastifyInstance;
  db: OncallDb;
  config: Config;
  broker: Broker;
  customerId: string;
}

/**
 * A fully-synchronous fake investigation engine (SDK-free): drives the real
 * wrapped sessions DAO + real steps DAO + real DB, so persistence + feed frames
 * are exercised deterministically. Mirrors the happy-path engine contract.
 */
const fakeEngineFactory: EngineFactory = (deps) => ({
  async investigate(incident, sink) {
    const session = deps.sessions.create({
      incident_id: incident.id,
      mode: 'live',
      model: 'fake-model',
      started_at: Date.now(),
    });
    const emit = (mapped: {
      type: 'thought' | 'tool_call' | 'tool_result' | 'conclusion' | 'error';
      tool_name?: string;
      tool_input?: unknown;
      tool_output?: unknown;
      content?: string;
    }): void => {
      const appended = deps.steps.append({ session_id: session.id, ...mapped });
      const now = Date.now();
      void sink.step?.({
        session_id: session.id,
        seq: appended.seq,
        type: mapped.type,
        tool_name: mapped.tool_name ?? null,
        tool_input: mapped.tool_input ?? null,
        tool_output: mapped.tool_output ?? null,
        content: mapped.content ?? null,
        created_at: now,
        ts: now,
      });
    };

    emit({ type: 'thought', content: 'Investigating the error-rate spike.' });
    emit({ type: 'tool_call', tool_name: 'get_recent_deploys', tool_input: {} });
    emit({ type: 'tool_result', tool_name: 'get_recent_deploys', tool_output: { deploys: [] } });

    const pr = deps.db.dao.pullRequests.create({
      incident_id: incident.id,
      customer_id: incident.customer_id,
      github_pr_number: 7,
      github_pr_id: 700,
      branch: 'oncall-ai/fix-x-a1b2c3',
      base_branch: 'main',
      title: 'Revert bad deploy',
      url: 'https://github.com/o/r/pull/7',
      kind: 'revert',
      diagnostic_report: '## Root Cause\nNull deref',
      head_sha: 'deadbeef0000',
    });
    deps.db.dao.incidents.update(incident.id, {
      status: 'fix_proposed',
      pr_id: pr.id,
      root_cause: 'Null deref introduced by deploy abc1234',
      confidence: 0.9,
      suspect_deploy_sha: 'abc1234def',
    });
    void sink.prCreated?.({ number: 7, url: pr.url, kind: 'revert' });
    emit({ type: 'conclusion', content: 'Root cause: null deref. Proposing a revert.' });
    void sink.conclusion?.({
      root_cause: 'Null deref introduced by deploy abc1234',
      confidence: 0.9,
      decision: 'propose_fix',
    });

    deps.sessions.finish(session.id, {
      status: 'completed',
      root_cause: 'Null deref introduced by deploy abc1234',
      confidence: 0.9,
      decision: 'propose_fix',
      iterations: 3,
      cost_usd: 0,
      completed_at: Date.now(),
    });

    return {
      session_id: session.id,
      status: 'completed',
      mode: 'live',
      model: 'fake-model',
      iterations: 3,
      root_cause: 'Null deref introduced by deploy abc1234',
      confidence: 0.9,
      decision: 'propose_fix',
      cost_usd: 0,
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
  const investigation = createInvestigationService({
    db,
    config,
    broker,
    engineFactory: fakeEngineFactory,
  });
  const app = await buildApp({ db, config, broker, investigation });
  return { app, db, config, broker, customerId: customer.id };
}

/** Seed a service + a metric sample + optional log rows. */
function seedService(h: Harness, service = 'checkout-api', ts = Date.now()): void {
  h.db.dao.services.touch(h.customerId, service, ts);
  h.db.dao.metricSamples.insert({
    customer_id: h.customerId,
    service,
    bucket_ts: ts,
    window_sec: 60,
    request_count: 40,
    error_count: 0,
    error_rate: 0,
    p50_ms: 30,
    p95_ms: 120,
    p99_ms: 200,
  });
}

function seedIncident(h: Harness, service = 'checkout-api'): Incident {
  const res = h.db.dao.incidents.openOrDedup({
    customer_id: h.customerId,
    service,
    detector: 'error_rate',
    fingerprint: 'fp-1',
    title: `Error-rate spike on ${service}`,
    severity: 'high',
    threshold_value: 0.2,
    observed_value: 0.87,
  });
  return res.incident;
}

/** Read an SSE stream over a real socket until `until(text)` or timeout, then abort. */
async function collectSse(
  url: string,
  opts: { until?: (text: string) => boolean; timeoutMs?: number } = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 3000);
  let text = '';
  try {
    const res = await fetch(url, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (opts.until && opts.until(text)) {
        controller.abort();
        break;
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') throw err;
  } finally {
    clearTimeout(timer);
  }
  return text;
}

/** Parse `event:`/`data:` frames out of an SSE payload. */
function parseFrames(text: string): { event: string; data: unknown }[] {
  const frames: { event: string; data: unknown }[] = [];
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n');
    const evLine = lines.find((l) => l.startsWith('event: '));
    const dataLine = lines.find((l) => l.startsWith('data: '));
    if (!evLine || !dataLine) continue;
    frames.push({
      event: evLine.slice('event: '.length),
      data: JSON.parse(dataLine.slice('data: '.length)),
    });
  }
  return frames;
}

async function baseUrl(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of openApps.splice(0)) await a.close();
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('C10 — SSE framing (pure)', () => {
  it('formats a named event frame exactly (SPEC §7 `event:`/`data:`)', () => {
    expect(formatSseEvent('log', { a: 1 })).toBe('event: log\ndata: {"a":1}\n\n');
  });
  it('formats a heartbeat comment (SPEC §7 `:heartbeat`)', () => {
    expect(formatSseComment('heartbeat')).toBe(': heartbeat\n\n');
  });
});

describe('C10 — services + metrics (SPEC §7.2)', () => {
  it('GET /services returns the health DTO shape', async () => {
    const h = await harness();
    seedService(h);
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/services' });
    expect(res.statusCode).toBe(200);
    const body = ServicesResponseSchema.parse(res.json());
    expect(body.services.map((s) => s.name)).toContain('checkout-api');
    await h.app.close();
  });

  it('GET /metrics returns a snapshot for a known service', async () => {
    const h = await harness();
    seedService(h);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/metrics?service=checkout-api&window_sec=900&resolution_sec=15',
    });
    expect(res.statusCode).toBe(200);
    const body = MetricsResponseSchema.parse(res.json());
    expect(body.service).toBe('checkout-api');
    expect(body.series.length).toBeGreaterThanOrEqual(1);
    await h.app.close();
  });

  it('GET /metrics 404s for an unknown service', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/metrics?service=ghost' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await h.app.close();
  });

  it('GET /metrics 400s when `service` is missing', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/metrics' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
    await h.app.close();
  });
});

describe('C10 — logs (SPEC §7.2b)', () => {
  it('GET /logs returns events (no customer_id) + a keyset cursor', async () => {
    const h = await harness();
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      h.db.dao.logEvents.insert({
        customer_id: h.customerId,
        service: 'checkout-api',
        level: 'error',
        message: `boom ${i}`,
        timestamp: now - i * 1000,
      });
    }
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/logs?service=checkout-api&limit=2',
    });
    expect(res.statusCode).toBe(200);
    const body = LogsResponseSchema.parse(res.json());
    expect(body.events).toHaveLength(2);
    expect((body.events[0] as Record<string, unknown>).customer_id).toBeUndefined();
    // Page was full (limit 2) → a cursor is returned.
    expect(body.next_before).not.toBeNull();
    await h.app.close();
  });

  it('GET /logs level filter is honored', async () => {
    const h = await harness();
    h.db.dao.logEvents.insert({ customer_id: h.customerId, service: 's', level: 'info', message: 'ok' });
    h.db.dao.logEvents.insert({ customer_id: h.customerId, service: 's', level: 'error', message: 'bad' });
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/logs?level=error' });
    const body = LogsResponseSchema.parse(res.json());
    expect(body.events.every((e) => e.level === 'error')).toBe(true);
    await h.app.close();
  });
});

describe('C10 — incidents list + detail (SPEC §7.3)', () => {
  it('GET /incidents returns summaries', async () => {
    const h = await harness();
    seedIncident(h);
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/incidents' });
    expect(res.statusCode).toBe(200);
    const body = IncidentsListResponseSchema.parse(res.json());
    expect(body.incidents).toHaveLength(1);
    expect(body.incidents[0].active).toBe(true);
    await h.app.close();
  });

  it('GET /incidents?status= filters', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    h.db.dao.incidents.update(inc.id, { status: 'resolved', resolved_at: Date.now() });
    const open = await h.app.inject({ method: 'GET', url: '/api/v1/incidents?status=open' });
    expect(IncidentsListResponseSchema.parse(open.json()).incidents).toHaveLength(0);
    const resolved = await h.app.inject({ method: 'GET', url: '/api/v1/incidents?status=resolved' });
    expect(IncidentsListResponseSchema.parse(resolved.json()).incidents).toHaveLength(1);
    await h.app.close();
  });

  it('GET /incidents/:id 404s for an unknown id', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/incidents/inc_missing' });
    expect(res.statusCode).toBe(404);
    await h.app.close();
  });

  it('GET /incidents/:id returns the full DTO after an investigation', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    // Run the fake investigation → session + steps + PR + escalation/fix persisted.
    await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/investigate` });
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/incidents/${inc.id}` });
    expect(res.statusCode).toBe(200);
    const body = IncidentDetailResponseSchema.parse(res.json());
    expect(body.incident.id).toBe(inc.id);
    expect(body.session?.status).toBe('completed');
    expect(body.steps.length).toBeGreaterThanOrEqual(4);
    expect(body.pull_request?.number).toBe(7);
    expect(body.timeline.map((t) => t.kind)).toContain('pr_opened');
    await h.app.close();
  });
});

describe('C10 — investigate (SPEC §7.3)', () => {
  it('POST /incidents/:id/investigate returns 202 + a session id', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${inc.id}/investigate`,
    });
    expect(res.statusCode).toBe(202);
    const body = InvestigateResponseSchema.parse(res.json());
    expect(body.session_id).toMatch(/^ses_/);
    // The session + steps actually persisted (closes C7's live-persistence gap).
    const session = h.db.dao.sessions.getById(body.session_id);
    expect(session?.status).toBe('completed');
    expect(h.db.dao.steps.countBySession(body.session_id)).toBeGreaterThanOrEqual(4);
    await h.app.close();
  });

  it('POST /incidents/:id/investigate 404s for an unknown incident', async () => {
    const h = await harness();
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/incidents/nope/investigate' });
    expect(res.statusCode).toBe(404);
    await h.app.close();
  });
});

describe('C10 — chat + postmortem (SPEC §7.4)', () => {
  it('POST /incidents/:id/chat answers grounded in evidence', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/investigate` });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${inc.id}/chat`,
      payload: { message: 'Why did this happen?' },
    });
    expect(res.statusCode).toBe(200);
    const body = ChatResponseSchema.parse(res.json());
    expect(body.message.role).toBe('assistant');
    expect(body.message.content).toContain('Null deref');
    expect((body.message.evidence ?? []).length).toBeGreaterThan(0);
    // Persisted transcript (user + assistant).
    expect(h.db.dao.chatMessages.listByIncident(inc.id)).toHaveLength(2);
    await h.app.close();
  });

  it('POST /incidents/:id/chat 400s on an empty message', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${inc.id}/chat`,
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
    await h.app.close();
  });

  it('POST then GET /incidents/:id/postmortem (FR-18)', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/investigate` });
    const post = await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/postmortem` });
    expect(post.statusCode).toBe(201);
    const body = PostmortemResponseSchema.parse(post.json());
    expect(body.postmortem).toContain('# Postmortem');
    expect(body.postmortem).toContain('## Root Cause');
    // Stored on the incident + retrievable via GET.
    const get = await h.app.inject({ method: 'GET', url: `/api/v1/incidents/${inc.id}/postmortem` });
    expect(get.statusCode).toBe(200);
    expect(PostmortemResponseSchema.parse(get.json()).postmortem).toBe(body.postmortem);
    await h.app.close();
  });

  it('GET /incidents/:id/postmortem 404s before generation', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/incidents/${inc.id}/postmortem` });
    expect(res.statusCode).toBe(404);
    await h.app.close();
  });
});

describe('C10 — SSE endpoints (real listen)', () => {
  it('GET /logs/stream frames ingested logs as `log` events', async () => {
    const h = await harness();
    seedService(h);
    openApps.push(h.app);
    const base = await baseUrl(h.app);
    const url = `${base}/api/v1/logs/stream?service=checkout-api`;

    const collected = collectSse(url, { until: (t) => t.includes('event: log') });
    // Give the connection a beat to subscribe, then ingest → publishes to the topic.
    await new Promise((r) => setTimeout(r, 80));
    writeBatch({ db: h.db, broker: h.broker }, h.db.dao.customers.getById(h.customerId)!, [
      { service: 'checkout-api', level: 'error', message: 'live boom' },
    ]);
    const text = await collected;
    const frames = parseFrames(text);
    const logFrame = frames.find((f) => f.event === 'log');
    expect(logFrame).toBeDefined();
    expect((logFrame!.data as { message: string }).message).toBe('live boom');
  });

  it('GET /incidents/:id/feed replays persisted steps then streams live', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    // Persist a session + two steps up front (the "already happened" part).
    const session = h.db.dao.sessions.create({ incident_id: inc.id, mode: 'live', model: 'm' });
    h.db.dao.steps.append({ session_id: session.id, type: 'thought', content: 'step-0' });
    h.db.dao.steps.append({ session_id: session.id, type: 'thought', content: 'step-1' });
    openApps.push(h.app);
    const base = await baseUrl(h.app);
    const url = `${base}/api/v1/incidents/${inc.id}/feed`;

    const collected = collectSse(url, { until: (t) => t.includes('"step-2"') });
    await new Promise((r) => setTimeout(r, 80));
    // A live step arrives after the subscriber connected.
    h.broker.publish(feedTopic(inc.id), {
      event: 'step',
      data: { seq: 2, type: 'thought', content: 'step-2' },
    });
    const text = await collected;
    const frames = parseFrames(text);

    // Framing is valid per the shared union.
    for (const f of frames) FeedEventSchema.parse(f);

    const replay = frames.find((f) => f.event === 'replay');
    expect(replay).toBeDefined();
    expect((replay!.data as { steps: unknown[] }).steps).toHaveLength(2);
    // session_started precedes replay; the live step comes after.
    const kinds = frames.map((f) => f.event);
    expect(kinds.indexOf('session_started')).toBeLessThan(kinds.indexOf('replay'));
    const liveStep = frames.find(
      (f) => f.event === 'step' && (f.data as { content?: string }).content === 'step-2',
    );
    expect(liveStep).toBeDefined();
  });

  it('feed dedupes a live step already present in the replay, passing newer ones', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    const session = h.db.dao.sessions.create({ incident_id: inc.id, mode: 'live', model: 'm' });
    h.db.dao.steps.append({ session_id: session.id, type: 'thought', content: 'dup', seq: 0 });
    openApps.push(h.app);
    const base = await baseUrl(h.app);

    const collected = collectSse(`${base}/api/v1/incidents/${inc.id}/feed`, {
      until: (t) => t.includes('"sentinel"'),
    });
    await new Promise((r) => setTimeout(r, 80));
    // Re-publish the already-replayed step (seq 0 → must be DROPPED), then a newer
    // live step (seq 5 → must PASS through).
    h.broker.publish(feedTopic(inc.id), { event: 'step', data: { seq: 0, type: 'thought', content: 'dup' } });
    h.broker.publish(feedTopic(inc.id), { event: 'step', data: { seq: 5, type: 'thought', content: 'sentinel' } });
    const text = await collected;
    const stepFrames = parseFrames(text).filter((f) => f.event === 'step');
    // Exactly the newer live step survives; the replayed seq-0 dup is dropped.
    expect(stepFrames).toHaveLength(1);
    expect((stepFrames[0].data as { content: string }).content).toBe('sentinel');
  });

  it('GET /incidents/:id/chat/stream emits token frames then done', async () => {
    const h = await harness();
    const inc = seedIncident(h);
    await h.app.inject({ method: 'POST', url: `/api/v1/incidents/${inc.id}/investigate` });
    openApps.push(h.app);
    const base = await baseUrl(h.app);
    const url = `${base}/api/v1/incidents/${inc.id}/chat/stream?message=${encodeURIComponent('why?')}`;
    const text = await collectSse(url, { until: (t) => t.includes('event: done') });
    const frames = parseFrames(text);
    expect(frames.some((f) => f.event === 'token')).toBe(true);
    const done = frames.find((f) => f.event === 'done');
    expect(done).toBeDefined();
    expect((done!.data as { content: string }).content).toContain('Null deref');
  });
});

describe('C10 — end-to-end (ingest → detect → investigate → persist → stream → DTO)', () => {
  it('drives the whole loop with a fake engine + ManualClock', async () => {
    const h = await harness();
    const clock = new ManualClock(1_000_000);
    const investigation = createInvestigationService({
      db: h.db,
      config: h.config,
      broker: h.broker,
      engineFactory: fakeEngineFactory,
    });
    const detection = createDetectionEngine({
      db: h.db,
      config: h.config,
      broker: h.broker,
      clock,
      enqueuer: investigation.enqueuer(),
      recoveryVerifier: null,
    });

    // Ingest a burst of errors on checkout-api (past the 0.2 / min-5 thresholds).
    const now = clock.now();
    const events = Array.from({ length: 10 }, () => ({
      service: 'checkout-api',
      level: 'error' as const,
      message: "Cannot read properties of undefined (reading 'items')",
      endpoint: '/api/checkout',
      method: 'POST',
      status: 500,
      latency_ms: 20,
      timestamp: now,
    }));
    writeBatch({ db: h.db, broker: h.broker }, h.db.dao.customers.getById(h.customerId)!, events);

    // One detection tick → opens an incident → auto-starts the (synchronous fake) investigation.
    const tick = detection.tick();
    expect(tick.opened).toHaveLength(1);
    const incidentId = tick.opened[0].id;

    // Session + steps persisted to SQLite (C7 live-persistence gap closed at C10).
    const session = h.db.dao.sessions.latestForIncident(incidentId);
    expect(session?.status).toBe('completed');
    expect(h.db.dao.steps.countBySession(session!.id)).toBeGreaterThanOrEqual(4);

    // Incident detail DTO is complete over HTTP.
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/incidents/${incidentId}` });
    const detail = IncidentDetailResponseSchema.parse(res.json());
    expect(detail.incident.status).toBe('fix_proposed');
    expect(detail.session?.status).toBe('completed');
    expect(detail.pull_request?.number).toBe(7);
    expect(detail.steps.length).toBeGreaterThanOrEqual(4);

    // The feed replays the persisted steps for a late subscriber.
    openApps.push(h.app);
    const base = await baseUrl(h.app);
    const text = await collectSse(`${base}/api/v1/incidents/${incidentId}/feed`, {
      until: (t) => t.includes('event: replay'),
      timeoutMs: 1500,
    });
    const replay = parseFrames(text).find((f) => f.event === 'replay');
    expect((replay!.data as { steps: unknown[] }).steps.length).toBeGreaterThanOrEqual(4);
  });
});
