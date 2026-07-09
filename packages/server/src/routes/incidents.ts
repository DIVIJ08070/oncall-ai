import type { FastifyInstance } from 'fastify';
import {
  ChatRequestSchema,
  IncidentsQuerySchema,
  type IncidentStatus,
} from '@oncall/shared';
import type { AppContext } from '../app.js';
import { buildIncidentDetail, toIncidentSummary } from '../incidents/detail.js';
import { answerIncidentChat } from '../chat/handler.js';
import { generateAndStorePostmortem } from '../postmortem/generate.js';
import { currentCustomer } from '../github/session.js';
import { sendError } from '../http/errors.js';
import { feedTopic } from '../sse/broker.js';
import { startSse } from '../sse/sse-reply.js';

/**
 * Incidents + investigation feed + chat + postmortem routes (SPEC §7.3/§7.4,
 * FR-05/06/08/14/16/18, NFR-06).
 */

/** Split a string into stream tokens (word + trailing whitespace) for `/chat/stream`. */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export function registerIncidentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config, broker } = ctx;

  /* ── GET /incidents (list) ─────────────────────────────────────────────── */
  app.get('/api/v1/incidents', async (req, reply) => {
    const parsed = IncidentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid incidents query', {
        issues: parsed.error.issues,
      });
    }
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to view incidents');
    }
    const { status, service, limit } = parsed.data;
    const incidents = db.dao.incidents.list({
      customer_id: customer.id,
      service,
      status: status as IncidentStatus | undefined,
      limit,
    });
    return reply.code(200).send({ incidents: incidents.map(toIncidentSummary) });
  });

  /* ── GET /incidents/:id (full detail DTO) ──────────────────────────────── */
  app.get('/api/v1/incidents/:id', async (req, reply) => {
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to view incidents');
    }
    const { id } = req.params as { id: string };
    const detail = buildIncidentDetail(db, id, customer.id);
    if (!detail) {
      return sendError(reply, 404, 'not_found', `Incident ${id} not found`);
    }
    return reply.code(200).send(detail);
  });

  /* ── POST /incidents/:id/investigate (manual re-trigger) ───────────────── */
  app.post('/api/v1/incidents/:id/investigate', async (req, reply) => {
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to start an investigation');
    }
    const { id } = req.params as { id: string };
    const incident = db.dao.incidents.getById(id);
    if (!incident || incident.customer_id !== customer.id) {
      return sendError(reply, 404, 'not_found', `Incident ${id} not found`);
    }
    if (!ctx.investigation) {
      return sendError(reply, 503, 'upstream_error', 'Investigation engine not available');
    }
    const handle = ctx.investigation.run(incident);
    if (!handle.session_id) {
      return sendError(reply, 500, 'internal', 'Failed to start the investigation');
    }
    return reply.code(202).send({ session_id: handle.session_id });
  });

  /* ── GET /incidents/:id/feed (SSE — replay-then-live) ──────────────────── */
  app.get('/api/v1/incidents/:id/feed', (req, reply) => {
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to view the feed');
    }
    const { id } = req.params as { id: string };
    const incident = db.dao.incidents.getById(id);
    if (!incident || incident.customer_id !== customer.id) {
      return sendError(reply, 404, 'not_found', `Incident ${id} not found`);
    }

    const channel = startSse(req, reply);

    // Buffer live frames until the persisted replay has been flushed, so a late
    // subscriber first receives a `replay` of persisted steps, then live (SPEC §7.3).
    let live = false;
    const buffer: { event: string; data: unknown }[] = [];
    let replayedMaxSeq = -1;

    const forward = (event: string, data: unknown): void => {
      // Drop a live `step` that the replay already contained (subscribe/read race).
      if (event === 'step') {
        const seq = (data as { seq?: number }).seq;
        if (typeof seq === 'number' && seq <= replayedMaxSeq) return;
      }
      channel.event(event, data);
    };

    const unsub = broker.subscribe(feedTopic(id), (msg) => {
      if (live) forward(msg.event, msg.data);
      else buffer.push({ event: msg.event, data: msg.data });
    });
    channel.onClose(unsub);

    // Replay the persisted steps of the latest session (NFR-06).
    const session = db.dao.sessions.latestForIncident(id);
    if (session) {
      channel.event('session_started', {
        session_id: session.id,
        mode: session.mode,
        model: session.model,
      });
      const steps = db.dao.steps.listBySession(session.id);
      for (const s of steps) if (s.seq > replayedMaxSeq) replayedMaxSeq = s.seq;
      channel.event('replay', { steps });
      if (session.status !== 'running') {
        channel.event('session_completed', {
          status: session.status,
          cost_usd: session.cost_usd,
          iterations: session.iterations,
        });
      }
    } else {
      channel.event('replay', { steps: [] });
    }

    // Go live: flush anything buffered during replay, then stream directly.
    live = true;
    for (const m of buffer.splice(0)) forward(m.event, m.data);
  });

  /* ── POST /incidents/:id/chat (read-only, grounded) ────────────────────── */
  app.post('/api/v1/incidents/:id/chat', async (req, reply) => {
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'A non-empty message is required', {
        issues: parsed.error.issues,
      });
    }
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to chat');
    }
    const { id } = req.params as { id: string };
    const incident = db.dao.incidents.getById(id);
    if (!incident || incident.customer_id !== customer.id) {
      return sendError(reply, 404, 'not_found', `Incident ${id} not found`);
    }
    const message = await answerIncidentChat(
      { db, config, responder: ctx.chatResponder },
      incident,
      parsed.data.message,
    );
    return reply.code(200).send({ message });
  });

  /* ── GET /incidents/:id/chat/stream (SSE token stream) ─────────────────── */
  app.get('/api/v1/incidents/:id/chat/stream', async (req, reply) => {
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to chat');
    }
    const { id } = req.params as { id: string };
    const message = (req.query as { message?: string }).message;
    if (!message || message.trim() === '') {
      return sendError(reply, 400, 'validation_error', 'A non-empty `message` query is required');
    }
    const incident = db.dao.incidents.getById(id);
    if (!incident || incident.customer_id !== customer.id) {
      return sendError(reply, 404, 'not_found', `Incident ${id} not found`);
    }

    const answer = await answerIncidentChat(
      { db, config, responder: ctx.chatResponder },
      incident,
      message,
    );

    const channel = startSse(req, reply);
    for (const text of tokenize(answer.content)) channel.event('token', { text });
    channel.event('done', { content: answer.content });
    channel.close();
  });

  /* ── POST /incidents/:id/postmortem (generate + store) ─────────────────── */
  app.post('/api/v1/incidents/:id/postmortem', async (req, reply) => {
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to generate a postmortem');
    }
    const { id } = req.params as { id: string };
    const markdown = generateAndStorePostmortem(db, id, customer.id);
    if (markdown === null) {
      return sendError(reply, 404, 'not_found', `Incident ${id} not found`);
    }
    return reply.code(201).send({ postmortem: markdown });
  });

  /* ── GET /incidents/:id/postmortem (stored draft) ──────────────────────── */
  app.get('/api/v1/incidents/:id/postmortem', async (req, reply) => {
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'Sign in to view the postmortem');
    }
    const { id } = req.params as { id: string };
    const incident = db.dao.incidents.getById(id);
    if (!incident || incident.customer_id !== customer.id) {
      return sendError(reply, 404, 'not_found', `Incident ${id} not found`);
    }
    if (!incident.postmortem) {
      return sendError(
        reply,
        404,
        'not_found',
        'No postmortem draft yet — POST to generate one',
      );
    }
    return reply.code(200).send({ postmortem: incident.postmortem });
  });
}
