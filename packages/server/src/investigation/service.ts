import { Octokit } from '@octokit/rest';
import {
  cachedEngineFactory,
  createEngine,
  createPinnedGitHub,
  type AgentEngineConfig,
  type EngineSessionsDao,
  type GitHubClient,
  type InvestigationEngine,
  type LiveEngineDeps,
  type PinnedGitHub,
  type StepSink,
  type ToolDb,
} from '@oncall/agent';
import type { Incident, SessionResult } from '@oncall/shared';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';
import { markInvestigating } from '../detection/lifecycle.js';
import type { InvestigationEnqueuer } from '../detection/seams.js';
import { feedTopic, type Broker } from '../sse/broker.js';

/**
 * Investigation service (SPEC §7.3, §9 — the C7 engine mounted into the platform).
 *
 * Bridges the detection loop (which opens an incident, FR-06) to the C7
 * `InvestigationEngine`: it marks the incident `investigating`, runs the engine
 * over the **real** SQLite DAOs so `investigation_sessions` / `investigation_steps`
 * persist (closing C7's deferred live-persistence gap), and streams every step —
 * plus `session_started` / `pr_created` / `conclusion` / `session_completed` — to
 * the incident's feed topic for the SSE endpoint (§7.3).
 *
 * The engine builder is injectable so `.inject()` tests stay SDK-free while the
 * boot path uses the real Claude Agent SDK loop (`createEngine`).
 */

export type EngineFactory = (deps: LiveEngineDeps) => InvestigationEngine;

export type ServiceLogger = (message: string, meta?: unknown) => void;

export interface InvestigationServiceDeps {
  db: OncallDb;
  config: Config;
  broker: Broker;
  /** Override the engine builder (tests inject a fake). Default = `createEngine` (live|auto). */
  engineFactory?: EngineFactory;
  logger?: ServiceLogger;
}

/** Result of kicking off a run: the session id (for the 202 body) + the run promise. */
export interface InvestigationHandle {
  session_id: string | null;
  done: Promise<SessionResult | null>;
}

/**
 * Adapt the concrete `OncallDb.dao` to the narrow `ToolDb` the agent tools read
 * through. An explicit adapter (rather than a structural cast) documents the seam
 * and pins the exact read surface the investigation may touch.
 */
function toToolDb(db: OncallDb): ToolDb {
  const dao = db.dao;
  return {
    dao: {
      logEvents: { query: (q) => dao.logEvents.query(q) },
      metricSamples: {
        latestForService: (c, s) => dao.metricSamples.latestForService(c, s),
        seriesForService: (c, s, since, limit) =>
          dao.metricSamples.seriesForService(c, s, since, limit),
      },
      deploys: {
        getBySha: (c, sha) => dao.deploys.getBySha(c, sha),
        getCurrent: (c) => dao.deploys.getCurrent(c),
        listRecent: (c, limit) => dao.deploys.listRecent(c, limit),
      },
      incidents: { update: (id, patch) => dao.incidents.update(id, patch) },
      pullRequests: { create: (input) => dao.pullRequests.create(input) },
      services: { getByName: (c, name) => dao.services.getByName(c, name) },
    },
  };
}

export class InvestigationService {
  private readonly db: OncallDb;
  private readonly config: Config;
  private readonly broker: Broker;
  private readonly engineFactory: EngineFactory;
  private readonly log: ServiceLogger;
  private readonly toolDb: ToolDb;
  private readonly pinned: PinnedGitHub;

  constructor(deps: InvestigationServiceDeps) {
    this.db = deps.db;
    this.config = deps.config;
    this.broker = deps.broker;
    this.log = deps.logger ?? (() => {});
    // Default engine selection (SPEC §9/§13): `AGENT_MODE` picks live|cached|auto.
    // Passing C8's `cachedEngineFactory` makes `cached` (and the `auto` fallback
    // when the subscription is unavailable) replay the recorded cache while still
    // opening a real PR via `CACHE_REAL_PR` (NFR-09 demo resilience).
    this.engineFactory =
      deps.engineFactory ?? ((d) => createEngine({ ...d, cachedEngineFactory }));
    this.toolDb = toToolDb(this.db);
    const octokit = new Octokit({ auth: this.config.github.token });
    this.pinned = createPinnedGitHub(
      octokit as unknown as GitHubClient,
      this.config.github,
    );
  }

  /** Feed sink (NFR-06): publish each step + the control frames to the SSE topic. */
  private makeFeedSink(incidentId: string): StepSink {
    const topic = feedTopic(incidentId);
    return {
      step: (s) => this.broker.publish(topic, { event: 'step', data: s }),
      prCreated: (d) => this.broker.publish(topic, { event: 'pr_created', data: d }),
      conclusion: (d) => this.broker.publish(topic, { event: 'conclusion', data: d }),
    };
  }

  /**
   * Start an investigation for `incident` (auto on open, or manual re-trigger via
   * `POST /incidents/:id/investigate`). Non-blocking: returns the session id once
   * the engine has created its session, and a `done` promise for the full run.
   */
  run(incident: Incident): InvestigationHandle {
    // open → investigating (SPEC §10.4).
    try {
      markInvestigating(this.db.dao.incidents, incident.id);
    } catch (err) {
      this.log('[investigation] markInvestigating failed', err);
    }
    const fresh = this.db.dao.incidents.getById(incident.id) ?? incident;
    const topic = feedTopic(incident.id);
    const sink = this.makeFeedSink(incident.id);

    // Wrap the sessions DAO so the feed sees session lifecycle frames and we can
    // capture the session id synchronously (the engine creates its session before
    // its first `await`).
    let sessionId: string | undefined;
    const sessions: EngineSessionsDao = {
      create: (input) => {
        const s = this.db.dao.sessions.create(input);
        sessionId = s.id;
        this.broker.publish(topic, {
          event: 'session_started',
          data: { session_id: s.id, mode: s.mode, model: s.model },
        });
        return s;
      },
      finish: (id, fields) => {
        const r = this.db.dao.sessions.finish(id, fields);
        this.broker.publish(topic, {
          event: 'session_completed',
          data: {
            status: fields.status,
            cost_usd: fields.cost_usd ?? 0,
            iterations: fields.iterations ?? 0,
          },
        });
        return r;
      },
    };

    let done: Promise<SessionResult | null>;
    try {
      const engine = this.engineFactory({
        db: this.toolDb,
        octokit: this.pinned,
        config: this.config as AgentEngineConfig,
        sessions,
        steps: this.db.dao.steps,
      });
      // Call synchronously so the engine's session `create` runs now (captures id).
      done = engine.investigate(fresh, sink).catch((err) => {
        this.log('[investigation] run failed', err);
        this.broker.publish(topic, {
          event: 'error',
          data: { message: err instanceof Error ? err.message : String(err) },
        });
        return null;
      });
    } catch (err) {
      // Synchronous build/throw (e.g. AGENT_MODE=cached before C8 is wired).
      this.log('[investigation] engine build failed', err);
      this.broker.publish(topic, {
        event: 'error',
        data: { message: err instanceof Error ? err.message : String(err) },
      });
      done = Promise.resolve(null);
    }

    return { session_id: sessionId ?? null, done };
  }

  /** Adapter the detection loop injects as its `enqueuer` (FR-06 auto-start). */
  enqueuer(): InvestigationEnqueuer {
    return {
      enqueue: (incident) => {
        this.run(incident);
      },
    };
  }
}

/** Factory mirroring the module conventions. */
export function createInvestigationService(
  deps: InvestigationServiceDeps,
): InvestigationService {
  return new InvestigationService(deps);
}
