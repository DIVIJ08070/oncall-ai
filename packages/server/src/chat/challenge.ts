import type {
  EvidenceRef,
  HypothesisChallengeResult,
  Incident,
  ReasoningEngine,
} from '@oncall/shared';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';
import { collectEvidence, loadChatEvidence } from './handler.js';
import { generateReasoningJson } from '../services/reasoning/engine.js';

/**
 * "Ask Why" — challenge the current hypothesis (Phase 5, plan C.7). A user can
 * push back on the recorded root cause ("no, we did not change the DB"); the
 * handler feeds that challenge + the prior hypothesis + the incident's persisted
 * evidence + the recent conversation back to the AI engine and returns a REVISED
 * hypothesis with an updated confidence and the reasoning.
 *
 * Conversation state is kept per incident by reusing the `chat_messages` table:
 * the challenge is stored as a `user` message and the revised hypothesis as an
 * `assistant` message, so a follow-up challenge sees the running thread. The
 * engine is grounded in the collected evidence and instructed never to invent
 * new facts; when the model is unavailable it degrades to a deterministic reply
 * that lowers confidence and asks for more investigation.
 */

/** How many prior turns of the incident thread to feed back as context. */
const HISTORY_TURNS = 6;

const CHALLENGE_SYSTEM_PROMPT =
  'You are an incident root-cause reasoning engine. A responder proposed a ' +
  'hypothesis for an incident; a human is now challenging it. Weigh the ' +
  'challenge against the EVIDENCE provided and return a revised hypothesis. ' +
  'Rules: use ONLY the incident facts and evidence given — never invent a ' +
  'deploy, file, metric, or cause not present. If the challenge plausibly rules ' +
  'out the prior cause, lower the confidence and propose the next most likely ' +
  'cause consistent with the evidence, or say more investigation is needed. If ' +
  'the challenge does not withstand the evidence, keep the hypothesis and explain ' +
  'why. Respond with ONLY a JSON object: {"hypothesis": string, "confidence": ' +
  'number (0-1), "changed": boolean, "reasoning": string (2-4 sentences citing ' +
  'the evidence)}. No markdown, no code fences.';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function buildChallengePrompt(
  incident: Incident,
  priorHypothesis: string | null,
  priorConfidence: number | null,
  evidence: EvidenceRef[],
  history: { role: string; content: string }[],
  challenge: string,
): string {
  const payload = {
    incident: {
      service: incident.service,
      detector: incident.detector,
      title: incident.title,
      status: incident.status,
      observed_value: incident.observed_value,
      threshold_value: incident.threshold_value,
      suspect_deploy_sha: incident.suspect_deploy_sha,
    },
    priorHypothesis: priorHypothesis ?? '(none recorded)',
    priorConfidence: priorConfidence,
    evidence: evidence.map((e) => (e.tool ? `${e.type}:${e.tool}(${e.ref})` : `${e.type}:${e.ref}`)),
    recentConversation: history.map((h) => `${h.role}: ${h.content}`),
    challenge,
  };
  return (
    'Re-evaluate the hypothesis in light of the challenge, grounded in the evidence.\n\n' +
    JSON.stringify(payload, null, 2)
  );
}

function heuristicChallenge(
  incident: Incident,
  priorHypothesis: string | null,
  priorConfidence: number | null,
  evidence: EvidenceRef[],
  challenge: string,
  engine: ReasoningEngine,
): HypothesisChallengeResult {
  // Deterministic fallback: acknowledge the challenge, soften confidence, and
  // hold the prior hypothesis pending more investigation.
  const confidence = clamp01((priorConfidence ?? 0.5) - 0.15);
  const hypothesis =
    priorHypothesis ??
    `Root cause for the ${incident.service} incident is not yet confirmed.`;
  const reasoning =
    `Noted the challenge ("${challenge.trim()}"). The AI engine was unavailable, so the ` +
    `prior hypothesis is retained with reduced confidence pending further investigation. ` +
    `Evidence on record: ${evidence.length} item(s).`;
  return {
    incidentId: incident.id,
    priorHypothesis,
    priorConfidence,
    hypothesis,
    confidence,
    changed: false,
    reasoning,
    evidence,
    engine,
    generatedAt: Date.now(),
  };
}

/**
 * Answer a challenge to the incident's current hypothesis. Persists the
 * challenge + the revised hypothesis to `chat_messages` (per-incident thread),
 * then returns the revised hypothesis DTO.
 */
export async function challengeHypothesis(
  deps: { db: OncallDb; config: Config },
  incident: Incident,
  challenge: string,
): Promise<HypothesisChallengeResult> {
  const { db, config } = deps;
  const chatEvidence = await loadChatEvidence(db, incident);
  const evidence = collectEvidence(chatEvidence);
  const priorHypothesis = chatEvidence.session?.root_cause ?? incident.root_cause;
  const priorConfidence = chatEvidence.session?.confidence ?? incident.confidence;

  const priorMessages = await db.dao.chatMessages.listByIncident(incident.id);
  const history = priorMessages
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }));

  // Persist the challenge as a user turn (before answering) so the thread order
  // is stable even if the engine is slow.
  await db.dao.chatMessages.insert({
    incident_id: incident.id,
    role: 'user',
    content: challenge,
  });

  let result: HypothesisChallengeResult;
  try {
    const { json, engine } = await generateReasoningJson(
      config,
      buildChallengePrompt(incident, priorHypothesis, priorConfidence, evidence, history, challenge),
      CHALLENGE_SYSTEM_PROMPT,
    );
    const obj = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
    const hypothesis =
      typeof obj.hypothesis === 'string' && obj.hypothesis.trim() !== ''
        ? obj.hypothesis.trim()
        : (priorHypothesis ?? `Root cause for the ${incident.service} incident is not yet confirmed.`);
    const confidence = clamp01(
      typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
        ? obj.confidence
        : (priorConfidence ?? 0.5),
    );
    const changed =
      typeof obj.changed === 'boolean'
        ? obj.changed
        : hypothesis.trim() !== (priorHypothesis ?? '').trim();
    const reasoning =
      typeof obj.reasoning === 'string' && obj.reasoning.trim() !== ''
        ? obj.reasoning.trim()
        : 'Re-evaluated the hypothesis against the recorded evidence.';
    result = {
      incidentId: incident.id,
      priorHypothesis,
      priorConfidence,
      hypothesis,
      confidence,
      changed,
      reasoning,
      evidence,
      engine,
      generatedAt: Date.now(),
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ask-why] AI reasoning unavailable (%s) — returning heuristic challenge reply.',
      err instanceof Error ? err.message : String(err),
    );
    result = heuristicChallenge(
      incident,
      priorHypothesis,
      priorConfidence,
      evidence,
      challenge,
      'heuristic',
    );
  }

  // Persist the revised hypothesis as an assistant turn (grounded evidence attached).
  await db.dao.chatMessages.insert({
    incident_id: incident.id,
    role: 'assistant',
    content: result.reasoning,
    evidence: result.evidence,
  });

  return result;
}
