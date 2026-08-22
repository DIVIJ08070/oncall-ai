import type { EvidenceRef } from './investigation.js';

/**
 * "Ask Why" + "What Changed?" reasoning domain (Phase 5). Pure response DTOs —
 * no runtime deps. The evidence-gathering + correlation math live in
 * `@oncall/server` (services/what-changed + chat/challenge); the AI ranking /
 * explanation is layered on top of that deterministic evidence, so nothing here
 * is invented by the model.
 */

/** Which engine produced a reasoning result (`heuristic` = deterministic fallback). */
export type ReasoningEngine = 'claude' | 'gemini' | 'heuristic';

/* ── "What Changed?" — deploy + metric correlation ─────────────────────── */

/** A deploy implicated as a candidate cause of an incident. */
export interface WhatChangedDeploy {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  /** Deploy provenance (e.g. `bad_deploy`, `baseline`, `github`). */
  source: string;
  committedAt: number;
  /** Whole minutes from this deploy to the incident (negative ⇒ after it began). */
  minutesBeforeIncident: number;
}

/** The kind of change a candidate represents. */
export type WhatChangedKind =
  | 'deploy'
  | 'error_rate'
  | 'latency'
  | 'timeout'
  | 'risk_escalation'
  | 'throughput';

/** One ranked candidate change correlated with the incident window. */
export interface WhatChangedChange {
  kind: WhatChangedKind;
  /** Short human ref — a deploy short sha, or the affected endpoint. */
  ref: string;
  summary: string;
  /** Metric value in the last-healthy window (null for a deploy / when unknown). */
  before: number | null;
  /** Metric value in the incident window (null for a deploy / when unknown). */
  after: number | null;
  /** 0-100 strength of correlation with the incident onset. */
  correlationPct: number;
}

/** Result of `GET /api/v1/incidents/:id/what-changed`. */
export interface WhatChangedResult {
  incidentId: string;
  service: string;
  /** Epoch ms the incident began (`first_error_at ?? detected_at ?? opened_at`). */
  incidentTime: number;
  /** Epoch ms of the last window the service looked healthy, or null. */
  lastHealthyAt: number | null;
  /** One-line description of the single most significant change. */
  mostSignificantChange: string;
  /** The prime suspect deploy (nearest before the incident), or null. */
  deploy: WhatChangedDeploy | null;
  /** 0-100 correlation of the most significant change with the incident. */
  correlationPct: number;
  /** Every candidate change, strongest correlation first. */
  relatedChanges: WhatChangedChange[];
  /** Evidence-grounded explanation (AI when available, else deterministic). */
  reasoning: string;
  engine: ReasoningEngine;
  generatedAt: number;
}

/* ── "Ask Why" — challenge the current hypothesis ──────────────────────── */

/** Result of `POST /api/v1/incidents/:id/challenge`. */
export interface HypothesisChallengeResult {
  incidentId: string;
  /** The hypothesis the challenge was weighed against (root cause on record). */
  priorHypothesis: string | null;
  priorConfidence: number | null;
  /** The revised hypothesis after weighing the challenge against the evidence. */
  hypothesis: string;
  /** Revised confidence, 0-1. */
  confidence: number;
  /** Whether the hypothesis changed materially from the prior one. */
  changed: boolean;
  /** Evidence-grounded reasoning for the revision. */
  reasoning: string;
  /** The evidence refs the reasoning is grounded in. */
  evidence: EvidenceRef[];
  engine: ReasoningEngine;
  generatedAt: number;
}
