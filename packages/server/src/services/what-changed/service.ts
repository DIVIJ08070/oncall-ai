import type {
  DeployRef,
  Incident,
  ReasoningEngine,
  WhatChangedChange,
  WhatChangedDeploy,
  WhatChangedResult,
} from '@oncall/shared';
import type { ApiPerformanceSampleRow } from '../../db/rows.js';
import type { OncallDb } from '../../db/index.js';
import type { Config } from '../../config.js';
import { generateReasoningJson } from '../reasoning/engine.js';

/**
 * "What Changed?" (Phase 5, plan C.7). Given an incident, gather the evidence of
 * what changed between the service's last-healthy state and the incident window —
 * the deploys committed just before the incident and the per-endpoint
 * performance deltas around it — then rank them by correlation and let the AI
 * engine pick + explain the single most significant change. The ranking numbers
 * are computed deterministically from real rows (never invented); the model only
 * selects among the gathered candidates and writes the prose explanation.
 */

const MINUTE_MS = 60_000;
/** How far back to look for deploys / a healthy baseline (30 min). */
const LOOKBACK_MS = 30 * MINUTE_MS;
/** Per-endpoint window history pulled to find the incident + baseline windows. */
const HISTORY_LIMIT = 240;

/** The epoch-ms instant an incident is treated as having begun. */
export function incidentOnset(incident: Incident): number {
  return incident.first_error_at ?? incident.detected_at ?? incident.opened_at;
}

/* ── deploy correlation (temporal proximity) ─────────────────────────────── */

/** 0-100 correlation of a deploy with the incident, from how close it landed. */
function deployCorrelation(minutesBefore: number, source: string): number {
  let base: number;
  if (minutesBefore < -1) base = 8; // landed after the incident began
  else if (minutesBefore <= 1) base = 92;
  else if (minutesBefore <= 2) base = 85;
  else if (minutesBefore <= 5) base = 72;
  else if (minutesBefore <= 10) base = 58;
  else if (minutesBefore <= 20) base = 42;
  else if (minutesBefore <= 30) base = 30;
  else base = 15;
  // A deploy whose provenance already flags a bad change is a stronger suspect.
  if (/bad_deploy|config_error|slow_db|error/i.test(source)) {
    base = Math.min(99, base + 6);
  }
  return Math.round(base);
}

function toWhatChangedDeploy(d: DeployRef, incidentTime: number): WhatChangedDeploy {
  const at = d.deployed_at ?? d.committed_at;
  return {
    sha: d.sha,
    shortSha: d.short_sha,
    message: d.message,
    author: d.author,
    source: d.source,
    committedAt: at,
    minutesBeforeIncident: Math.round((incidentTime - at) / MINUTE_MS),
  };
}

/* ── per-endpoint performance deltas ─────────────────────────────────────── */

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Is a window healthy enough to serve as a baseline for the "before" side? */
function isHealthyWindow(row: ApiPerformanceSampleRow): boolean {
  return row.performance_score >= 85 && row.risk_score <= 25 && row.error_rate < 0.05;
}

/** Does the incident-side window actually show degradation worth reporting? */
function isDegraded(row: ApiPerformanceSampleRow, baseline: ApiPerformanceSampleRow | null): boolean {
  if (row.performance_score <= 75 || row.risk_score >= 40) return true;
  if (row.error_rate >= 0.1 || row.timeout_rate >= 0.1) return true;
  if (baseline && baseline.p95_latency_ms > 0 && row.p95_latency_ms >= baseline.p95_latency_ms * 3) {
    return true;
  }
  return false;
}

/** Classify the dominant symptom of a degraded window vs. its baseline. */
function classify(
  row: ApiPerformanceSampleRow,
  baseline: ApiPerformanceSampleRow | null,
): { kind: WhatChangedChange['kind']; before: number | null; after: number | null; summary: string } {
  const baseP95 = baseline?.p95_latency_ms ?? null;
  const baseErr = baseline?.error_rate ?? null;
  const errPct = Math.round(row.error_rate * 100);
  if (row.error_rate >= 0.1 && row.error_rate >= (baseErr ?? 0) + 0.05) {
    return {
      kind: 'error_rate',
      before: baseErr === null ? null : Math.round(baseErr * 100),
      after: errPct,
      summary: `${row.endpoint} error rate rose to ${errPct}%`,
    };
  }
  if (row.timeout_rate >= 0.1) {
    return {
      kind: 'timeout',
      before: baseline ? Math.round(baseline.timeout_rate * 100) : null,
      after: Math.round(row.timeout_rate * 100),
      summary: `${row.endpoint} timeouts rose to ${Math.round(row.timeout_rate * 100)}%`,
    };
  }
  if (baseP95 !== null && baseP95 > 0 && row.p95_latency_ms >= baseP95 * 2) {
    return {
      kind: 'latency',
      before: Math.round(baseP95),
      after: Math.round(row.p95_latency_ms),
      summary: `${row.endpoint} p95 latency rose ${Math.round(baseP95)}ms → ${Math.round(row.p95_latency_ms)}ms`,
    };
  }
  return {
    kind: 'risk_escalation',
    before: baseline ? baseline.risk_score : null,
    after: row.risk_score,
    summary: `${row.endpoint} risk climbed to ${row.risk_score}/100 (score ${row.performance_score})`,
  };
}

/**
 * For one endpoint's newest-first window history, find the window at the incident
 * onset and the most recent healthy window before it, and — if the incident-side
 * window is degraded — emit a ranked change.
 */
function endpointChange(
  history: ApiPerformanceSampleRow[],
  incidentTime: number,
): { change: WhatChangedChange; baselineAt: number | null } | null {
  if (history.length === 0) return null;
  // Window at the incident: newest window whose start is at/just before onset
  // (histories are newest-first). Fall back to the newest available.
  const incidentWindow =
    history.find((r) => r.window_start <= incidentTime) ?? history[history.length - 1]!;
  const idx = history.indexOf(incidentWindow);
  // Baseline: nearest healthy window strictly before the incident window.
  let baseline: ApiPerformanceSampleRow | null = null;
  for (let i = idx + 1; i < history.length; i++) {
    if (isHealthyWindow(history[i]!)) {
      baseline = history[i]!;
      break;
    }
  }
  if (baseline === null && idx + 1 < history.length) baseline = history[idx + 1]!;

  if (!isDegraded(incidentWindow, baseline)) return null;

  const c = classify(incidentWindow, baseline);
  const scoreDrop = baseline ? Math.max(0, baseline.performance_score - incidentWindow.performance_score) : 0;
  const correlationPct = clampPct(0.45 * scoreDrop + 0.55 * incidentWindow.risk_score);
  return {
    change: {
      kind: c.kind,
      ref: incidentWindow.endpoint,
      summary: c.summary,
      before: c.before,
      after: c.after,
      correlationPct: Math.max(20, correlationPct),
    },
    baselineAt: baseline ? baseline.window_start : null,
  };
}

/* ── evidence gathering + heuristic ranking ──────────────────────────────── */

export interface WhatChangedEvidence {
  incident: Incident;
  incidentTime: number;
  lastHealthyAt: number | null;
  primeDeploy: WhatChangedDeploy | null;
  deployChanges: WhatChangedChange[];
  perfChanges: WhatChangedChange[];
}

/** Gather the deploy + performance evidence around an incident (read-only). */
export async function gatherWhatChanged(
  db: OncallDb,
  incident: Incident,
): Promise<WhatChangedEvidence> {
  const incidentTime = incidentOnset(incident);

  // Deploys committed within the lookback and at/before the incident onset.
  const recentDeploys = await db.dao.deploys.listRecent(incident.customer_id, 50);
  const candidateDeploys = recentDeploys
    .map((d) => toWhatChangedDeploy(d, incidentTime))
    .filter((d) => d.committedAt <= incidentTime + MINUTE_MS && d.committedAt >= incidentTime - LOOKBACK_MS)
    .sort((a, b) => b.committedAt - a.committedAt);

  const deployChanges: WhatChangedChange[] = candidateDeploys.map((d) => ({
    kind: 'deploy',
    ref: d.shortSha,
    summary: `Deploy ${d.shortSha} "${d.message}" by ${d.author}, ${d.minutesBeforeIncident} min before the incident`,
    before: null,
    after: null,
    correlationPct: deployCorrelation(d.minutesBeforeIncident, d.source),
  }));
  const primeDeploy = candidateDeploys[0] ?? null;

  // Per-endpoint performance deltas for the affected service around the window.
  const latest = await db.dao.apiPerformance.latestPerService([incident.service]);
  const endpoints = latest.map((r) => r.endpoint);
  const perfChanges: WhatChangedChange[] = [];
  const baselineTimes: number[] = [];
  for (const endpoint of endpoints) {
    const history = await db.dao.apiPerformance.listRecentForEndpoint(
      incident.service,
      endpoint,
      HISTORY_LIMIT,
    );
    const res = endpointChange(history, incidentTime);
    if (res) {
      perfChanges.push(res.change);
      if (res.baselineAt !== null) baselineTimes.push(res.baselineAt);
    }
  }
  perfChanges.sort((a, b) => b.correlationPct - a.correlationPct);

  const lastHealthyAt = baselineTimes.length ? Math.max(...baselineTimes) : null;

  return { incident, incidentTime, lastHealthyAt, primeDeploy, deployChanges, perfChanges };
}

/* ── AI ranking + explanation over the gathered evidence ─────────────────── */

const WHAT_CHANGED_SYSTEM_PROMPT =
  'You are an incident change-correlation engine for an SRE tool. You are given ' +
  'an incident and a list of CANDIDATE changes (deploys and performance-metric ' +
  'shifts) that were gathered from real telemetry, each with a computed ' +
  'correlation score. Pick the single most significant change and explain the ' +
  'correlation. Use ONLY the candidates provided — never invent a deploy, ' +
  'endpoint, metric, or cause that is not in the list. Respond with ONLY a JSON ' +
  'object: {"mostSignificantRef": string (the `ref` of the chosen candidate), ' +
  '"mostSignificantChange": string (one sentence), "reasoning": string (2-4 ' +
  'sentences citing the candidates)}. No markdown, no code fences.';

function buildWhatChangedPrompt(ev: WhatChangedEvidence): string {
  const candidates = [...ev.deployChanges, ...ev.perfChanges].map((c) => ({
    ref: c.ref,
    kind: c.kind,
    summary: c.summary,
    before: c.before,
    after: c.after,
    correlationPct: c.correlationPct,
  }));
  const payload = {
    incident: {
      service: ev.incident.service,
      detector: ev.incident.detector,
      title: ev.incident.title,
      observed_value: ev.incident.observed_value,
      threshold_value: ev.incident.threshold_value,
      incidentTime: new Date(ev.incidentTime).toISOString(),
      lastHealthyAt: ev.lastHealthyAt ? new Date(ev.lastHealthyAt).toISOString() : null,
    },
    candidates,
  };
  return (
    'Correlate the incident with the most significant change from the candidates.\n\n' +
    JSON.stringify(payload, null, 2)
  );
}

function heuristicResult(ev: WhatChangedEvidence, engine: ReasoningEngine): WhatChangedResult {
  const all = [...ev.deployChanges, ...ev.perfChanges].sort(
    (a, b) => b.correlationPct - a.correlationPct,
  );
  const top = all[0] ?? null;
  const reasoningParts: string[] = [];
  if (ev.primeDeploy) {
    reasoningParts.push(
      `Deploy ${ev.primeDeploy.shortSha} ("${ev.primeDeploy.message}") landed ${ev.primeDeploy.minutesBeforeIncident} min before the incident began.`,
    );
  }
  if (ev.perfChanges.length) {
    reasoningParts.push(
      `${ev.perfChanges.length} endpoint(s) on ${ev.incident.service} degraded around the incident window, led by ${ev.perfChanges[0]!.summary}.`,
    );
  }
  if (reasoningParts.length === 0) {
    reasoningParts.push('No deploy or performance change was found around the incident window.');
  }
  return {
    incidentId: ev.incident.id,
    service: ev.incident.service,
    incidentTime: ev.incidentTime,
    lastHealthyAt: ev.lastHealthyAt,
    mostSignificantChange: top?.summary ?? 'No correlated change found.',
    deploy: ev.primeDeploy,
    correlationPct: top?.correlationPct ?? 0,
    relatedChanges: all,
    reasoning: reasoningParts.join(' '),
    engine,
    generatedAt: Date.now(),
  };
}

/**
 * Compute the full "What Changed?" result for an incident: gather the evidence,
 * rank it deterministically, then let the AI engine choose + explain the most
 * significant change. Degrades to the deterministic heuristic when the model is
 * unavailable, so the endpoint always returns.
 */
export async function computeWhatChanged(
  db: OncallDb,
  config: Config,
  incident: Incident,
): Promise<WhatChangedResult> {
  const ev = await gatherWhatChanged(db, incident);
  const heuristic = heuristicResult(ev, 'heuristic');

  // No candidates ⇒ nothing for the model to rank; return the deterministic answer.
  if (heuristic.relatedChanges.length === 0) return heuristic;

  try {
    const { json, engine } = await generateReasoningJson(
      config,
      buildWhatChangedPrompt(ev),
      WHAT_CHANGED_SYSTEM_PROMPT,
    );
    const obj = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
    const chosenRef = typeof obj.mostSignificantRef === 'string' ? obj.mostSignificantRef : null;
    const chosen = heuristic.relatedChanges.find((c) => c.ref === chosenRef) ?? null;
    const mostSignificantChange =
      typeof obj.mostSignificantChange === 'string' && obj.mostSignificantChange.trim() !== ''
        ? obj.mostSignificantChange.trim()
        : (chosen?.summary ?? heuristic.mostSignificantChange);
    const reasoning =
      typeof obj.reasoning === 'string' && obj.reasoning.trim() !== ''
        ? obj.reasoning.trim()
        : heuristic.reasoning;
    return {
      ...heuristic,
      // Keep the correlation grounded in the computed number for the chosen candidate.
      mostSignificantChange,
      correlationPct: chosen?.correlationPct ?? heuristic.correlationPct,
      reasoning,
      engine,
      generatedAt: Date.now(),
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[what-changed] AI ranking unavailable (%s) — returning heuristic correlation.',
      err instanceof Error ? err.message : String(err),
    );
    return heuristic;
  }
}
