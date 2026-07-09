import type {
  ChatMessage,
  EvidenceRef,
  Incident,
  PullRequestRec,
  Session,
} from '@oncall/shared';
import type { StoredStep } from '../db/dao/investigation-steps.js';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';

/**
 * Chat handler (SPEC §7.4, FR-16). Answers a question about an incident with a
 * **read-only**, evidence-grounded reply: the six investigation tools minus
 * `create_fix_pr`, grounded in the incident's persisted evidence (root cause,
 * session findings, tool steps, suspect deploy, PR).
 *
 * The responder is a seam (`ChatResponder`): the default implementation is a
 * deterministic grounder over the already-persisted investigation evidence (so
 * `.inject()` tests + the offline demo are stable, NFR-09), and the real bounded
 * Claude read-only tool loop can be injected in its place without touching the
 * route. It never calls a write tool.
 */

export interface ChatEvidence {
  incident: Incident;
  session: Session | null;
  steps: StoredStep[];
  pr: PullRequestRec | null;
}

export interface ChatResponderContext extends ChatEvidence {
  message: string;
}

export type ChatResponder = (
  deps: { db: OncallDb; config: Config },
  ctx: ChatResponderContext,
) => ChatMessage | Promise<ChatMessage>;

/** Load the persisted evidence a chat answer is grounded in (read-only). */
export function loadChatEvidence(db: OncallDb, incident: Incident): ChatEvidence {
  const session = db.dao.sessions.latestForIncident(incident.id);
  const steps = session ? db.dao.steps.listBySession(session.id) : [];
  const pr = db.dao.pullRequests.getByIncident(incident.id);
  return { incident, session: session ?? null, steps, pr };
}

/** A short human ref for a tool step (used as the evidence `ref`). */
function stepRef(step: StoredStep): string | null {
  const input = (step.tool_input ?? {}) as Record<string, unknown>;
  switch (step.tool_name) {
    case 'get_deploy_diff':
      if (typeof input.sha === 'string') return input.sha;
      if (typeof input.base === 'string' && typeof input.head === 'string') {
        return `${input.base}...${input.head}`;
      }
      return null;
    case 'read_file':
      return typeof input.path === 'string' ? input.path : null;
    case 'get_recent_deploys':
      return 'recent deploys';
    case 'search_logs':
      return typeof input.query === 'string' ? input.query : 'logs';
    case 'get_metrics':
      return typeof input.service === 'string' ? input.service : 'metrics';
    default:
      return null;
  }
}

/** Collect (deduped) evidence refs from the persisted tool-call steps + suspect deploy. */
export function collectEvidence(ev: ChatEvidence): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  const seen = new Set<string>();
  const push = (ref: EvidenceRef): void => {
    const key = `${ref.type}|${ref.tool ?? ''}|${ref.ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  if (ev.incident.suspect_deploy_sha) {
    push({ type: 'deploy', tool: 'get_recent_deploys', ref: ev.incident.suspect_deploy_sha });
  }
  for (const step of ev.steps) {
    if (step.type !== 'tool_call' || !step.tool_name) continue;
    const ref = stepRef(step);
    if (ref) push({ type: 'tool', tool: step.tool_name, ref });
  }
  if (ev.pr) {
    push({ type: 'pull_request', tool: 'create_fix_pr', ref: ev.pr.url });
  }
  return refs;
}

/**
 * Default grounded responder. Composes a factual answer from the persisted
 * investigation evidence — no LLM, fully deterministic. Read-only by construction
 * (it only reads rows).
 */
export const defaultChatResponder: ChatResponder = (_deps, ctx) => {
  const { incident, session, pr, message } = ctx;
  const evidence = collectEvidence(ctx);
  const rootCause = session?.root_cause ?? incident.root_cause;
  const confidence = session?.confidence ?? incident.confidence;

  const lines: string[] = [];
  lines.push(`Regarding "${message.trim()}" on ${incident.service}:`);

  if (rootCause) {
    lines.push(`Root cause: ${rootCause}`);
  } else if (incident.status === 'open' || incident.status === 'investigating') {
    lines.push('The investigation is still in progress; no root cause has been confirmed yet.');
  } else {
    lines.push('No root cause was recorded for this incident.');
  }

  if (typeof confidence === 'number') {
    lines.push(`Confidence: ${(confidence * 100).toFixed(0)}%.`);
  }

  if (incident.suspect_deploy_sha) {
    lines.push(
      `The suspect change is deploy ${incident.suspect_deploy_sha.slice(0, 7)}, correlated from the deploy history.`,
    );
  }

  if (pr) {
    lines.push(
      `A ${pr.kind} fix was proposed as PR #${pr.github_pr_number} (${pr.state}) — ${pr.url}.`,
    );
  } else if (session?.decision === 'escalate' || incident.status === 'escalated') {
    lines.push('The agent escalated this incident to a human rather than opening a fix PR.');
  }

  if (evidence.length > 0) {
    const cited = evidence
      .map((e) => (e.tool ? `${e.tool}(${e.ref})` : e.ref))
      .join(', ');
    lines.push(`Evidence: ${cited}.`);
  }

  return {
    role: 'assistant',
    content: lines.join('\n'),
    evidence,
  };
};

/**
 * Answer a chat message about an incident. Persists both the user message and the
 * assistant reply to `chat_messages` (FR-16), then returns the reply DTO.
 */
export async function answerIncidentChat(
  deps: { db: OncallDb; config: Config; responder?: ChatResponder },
  incident: Incident,
  message: string,
): Promise<ChatMessage> {
  const responder = deps.responder ?? defaultChatResponder;
  const evidence = loadChatEvidence(deps.db, incident);

  deps.db.dao.chatMessages.insert({
    incident_id: incident.id,
    role: 'user',
    content: message,
  });

  const reply = await responder(
    { db: deps.db, config: deps.config },
    { ...evidence, message },
  );

  deps.db.dao.chatMessages.insert({
    incident_id: incident.id,
    role: 'assistant',
    content: reply.content,
    evidence: reply.evidence ?? null,
  });

  return reply;
}
