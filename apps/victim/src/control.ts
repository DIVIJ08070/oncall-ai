/**
 * Demo control plane (SPEC §7.7, §12).
 *
 *   POST /__control/failure-mode  { mode }            -> 200 { mode }
 *   POST /__control/degrade       { … }               -> 200 { ok, degrade }
 *   POST /__control/degrade/clear                     -> 200 { ok, degrade: null }
 *   GET  /__control/state                             -> 200 { mode, deployed_sha, degrade }
 *
 * `activeMode` is in-memory (flipped without redeploy). `deployed_sha` is the real
 * git SHA the active mode maps to, read from the seed manifest that
 * `scripts/init-victim-repo.ts` records (baseline SHA for `healthy`). Field name is
 * unified with the platform `POST /api/v1/demo/failure-mode` response (BUG-004).
 *
 * `activeDegrade` is a SEPARATE, additive knob from the failure modes: a controlled
 * degradation that makes a signal CLIMB gradually over `rampSeconds` — so the platform
 * trend prediction shows a rising "may breach in ~N min" BEFORE the metric actually
 * crosses its SLO. Two families share the one knob:
 *   - request-level (`latency` | `errors`): ramps one endpoint's added delay / injected
 *     failure probability, applied per-request by the degradation middleware in
 *     `services/index.ts`;
 *   - HOST-level (`cpu` | `dbpool`): ramps the process's REPORTED cpu_pct / db_pool_pct
 *     upward, read by the host sampler (`host.ts`) so the AI EARLY WARNING card shows
 *     e.g. CPU 40→55→65→75→82 climbing toward its threshold.
 * The failure modes are untouched by either.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express, Request, Response } from 'express';
import { config, FAILURE_MODES, isFailureMode, type FailureMode } from './config.js';

let activeMode: FailureMode = 'healthy';

export function getActiveMode(): FailureMode {
  return activeMode;
}

export function setActiveMode(mode: FailureMode): void {
  activeMode = mode;
}

/* ── controlled degradation (predictive-trend demo) ──────────────────────── */

/**
 * Request-level degradations (`latency` | `errors`) shape one endpoint's per-request
 * behavior; HOST-level degradations (`cpu` | `dbpool`) ramp the process's reported
 * resource metrics for the AI EARLY WARNING card. All share the single `activeDegrade`.
 */
export type DegradeKind = 'latency' | 'errors' | 'cpu' | 'dbpool';

/** The HOST-level degrade kinds (ramp reported cpu_pct / db_pool_pct). */
export const HOST_DEGRADE_KINDS: readonly DegradeKind[] = ['cpu', 'dbpool'];

export function isHostDegradeKind(kind: DegradeKind): boolean {
  return kind === 'cpu' || kind === 'dbpool';
}

/** An active controlled degradation targeting one (service, endpoint). */
export interface DegradeState {
  /** Telemetry service name to match (e.g. `payments-api`). */
  service: string;
  /** Exact endpoint path to match (e.g. `/api/payments/charge`); `''` = any path. */
  endpoint: string;
  /**
   * `latency` ramps extra delay; `errors` ramps an injected-failure probability;
   * `cpu` / `dbpool` ramp the process's reported cpu_pct / db_pool_pct (HOST layer).
   */
  kind: DegradeKind;
  /** Seconds over which the effect climbs from 0 to its ceiling (then holds). */
  rampSeconds: number;
  /** Epoch ms the ramp started (progress = elapsed / rampSeconds). */
  startedAt: number;
  /** Latency ceiling (ms of EXTRA delay at full ramp) for `kind: latency`. */
  maxExtraLatencyMs: number;
  /** Error-rate ceiling (0-1 injected-failure probability) for `kind: errors`. */
  maxErrorRatio: number;
  /** Host-metric ramp FLOOR (starting %) for `kind: cpu | dbpool`. */
  minHostPct: number;
  /** Host-metric ramp CEILING (full-ramp %) for `kind: cpu | dbpool`. */
  maxHostPct: number;
}

/** Defaults chosen so the demo target (payments charge) breaches ~mid-ramp. */
export const DEGRADE_DEFAULTS = {
  service: 'payments-api',
  endpoint: '/api/payments/charge',
  kind: 'latency' as DegradeKind,
  rampSeconds: 120,
  maxExtraLatencyMs: 1600,
  maxErrorRatio: 0.6,
  // HOST ramp: climb from 40% up past the CPU (85) / DB-pool (90) thresholds so the
  // AI EARLY WARNING card shows a rising prediction that eventually breaches.
  minHostPct: 40,
  maxHostPct: 95,
} as const;

let activeDegrade: DegradeState | null = null;

export function getDegrade(): DegradeState | null {
  return activeDegrade;
}

export function setDegrade(state: DegradeState): void {
  activeDegrade = state;
}

export function clearDegrade(): void {
  activeDegrade = null;
}

/** What the degradation currently does to one request (0-effect when inactive). */
export interface DegradeEffect {
  /** Extra latency to add before the handler runs (ms). */
  extraDelayMs: number;
  /** Whether this request should be failed (503) instead of handled. */
  injectError: boolean;
  /** Ramp progress 0-1 (for observability). */
  progress: number;
}

const NO_EFFECT: DegradeEffect = { extraDelayMs: 0, injectError: false, progress: 0 };

/**
 * Resolve the current degradation effect for a request. Returns a zero-effect
 * result unless a degradation is active AND matches (service + endpoint path).
 * `path` is the endpoint path WITHOUT query string (matches what telemetry ships).
 */
export function degradeEffectFor(
  service: string,
  path: string,
  now: number = Date.now(),
): DegradeEffect {
  const d = activeDegrade;
  if (!d) return NO_EFFECT;
  // HOST-level degrades (cpu/dbpool) never touch the request path — they only
  // ramp reported resource metrics, read separately by the host sampler.
  if (isHostDegradeKind(d.kind)) return NO_EFFECT;
  if (d.service && d.service !== service) return NO_EFFECT;
  if (d.endpoint && d.endpoint !== path) return NO_EFFECT;

  const elapsed = Math.max(0, now - d.startedAt);
  const progress = d.rampSeconds > 0 ? Math.min(1, elapsed / (d.rampSeconds * 1000)) : 1;

  if (d.kind === 'latency') {
    // Ramp 0 → maxExtraLatencyMs, ±10% jitter so the p95 curve looks organic.
    const base = progress * d.maxExtraLatencyMs;
    const jittered = base * (0.9 + Math.random() * 0.2);
    return { extraDelayMs: Math.round(jittered), injectError: false, progress };
  }
  // errors: injected-failure probability climbs 0 → maxErrorRatio.
  const failProb = progress * d.maxErrorRatio;
  return { extraDelayMs: 0, injectError: Math.random() < failProb, progress };
}

/* ── HOST-level degrade (ramps reported cpu_pct / db_pool_pct) ────────────── */

/** What a HOST degrade currently reports for cpu / db-pool (null = not ramped). */
export interface HostDegradeEffect {
  /** Ramped CPU% to report, or `null` when no `cpu` degrade is active. */
  cpuPct: number | null;
  /** Ramped DB-pool% to report, or `null` when no `dbpool` degrade is active. */
  dbPoolPct: number | null;
  /** Ramp progress 0-1 (for observability). */
  progress: number;
}

const NO_HOST_EFFECT: HostDegradeEffect = { cpuPct: null, dbPoolPct: null, progress: 0 };

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/**
 * The host-metric value the active degrade currently dictates. Returns a nulls
 * result unless a `cpu` / `dbpool` degrade is active; when one is, the matching
 * metric ramps `minHostPct → maxHostPct` across `rampSeconds` (small ±2% jitter so
 * the sparkline looks organic) and holds at the ceiling. The host sampler overlays
 * the non-null field onto its otherwise-real reading.
 */
export function hostDegradeEffect(now: number = Date.now()): HostDegradeEffect {
  const d = activeDegrade;
  if (!d || !isHostDegradeKind(d.kind)) return NO_HOST_EFFECT;

  const elapsed = Math.max(0, now - d.startedAt);
  const progress = d.rampSeconds > 0 ? Math.min(1, elapsed / (d.rampSeconds * 1000)) : 1;
  const ramped = d.minHostPct + progress * (d.maxHostPct - d.minHostPct);
  const jittered = clampPct(ramped * (0.98 + Math.random() * 0.04));

  if (d.kind === 'cpu') return { cpuPct: jittered, dbPoolPct: null, progress };
  return { cpuPct: null, dbPoolPct: jittered, progress };
}

function numOr(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/* ── seed manifest (mode → real bad SHA) ─────────────────────────────────── */

interface ManifestEntry {
  sha: string;
  short_sha?: string;
  message?: string;
}
interface DeployManifest {
  repo?: string;
  url?: string;
  default_branch?: string;
  baseline?: ManifestEntry;
  modes?: Partial<Record<Exclude<FailureMode, 'healthy'>, ManifestEntry>>;
}

/** Candidate manifest locations, tried in order (first existing wins). */
function manifestCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const out: string[] = [];
  if (config.manifestPath) out.push(resolve(config.manifestPath));
  // repo-root data dir when run from the monorepo (…/apps/victim/{src|dist} → root)
  out.push(resolve(here, '../../../data/victim-manifest.json'));
  out.push(resolve(here, '../../../../data/victim-manifest.json'));
  out.push(join(process.cwd(), 'data/victim-manifest.json'));
  return out;
}

let manifestCache: DeployManifest | null | undefined;

function loadManifest(): DeployManifest | null {
  if (manifestCache !== undefined) return manifestCache;
  for (const p of manifestCandidates()) {
    try {
      if (existsSync(p)) {
        manifestCache = JSON.parse(readFileSync(p, 'utf8')) as DeployManifest;
        return manifestCache;
      }
    } catch {
      // ignore malformed candidate, try the next
    }
  }
  manifestCache = null;
  return manifestCache;
}

/** The real git SHA "deployed" for the currently active mode (null if unseeded). */
export function deployedShaFor(mode: FailureMode): string | null {
  const m = loadManifest();
  if (!m) return null;
  if (mode === 'healthy') return m.baseline?.sha ?? null;
  return m.modes?.[mode]?.sha ?? null;
}

/* ── routes ──────────────────────────────────────────────────────────────── */

export function registerControl(app: Express): void {
  app.post('/__control/failure-mode', (req: Request, res: Response) => {
    const mode = (req.body ?? {}).mode;
    if (!isFailureMode(mode)) {
      return res.status(400).json({
        error: {
          code: 'validation_error',
          message: `mode must be one of: ${FAILURE_MODES.join(', ')}`,
        },
      });
    }
    setActiveMode(mode);
    return res.status(200).json({ mode });
  });

  // Controlled degradation — start a gradual ramp. Request-level kinds
  // (`latency` | `errors`) target one endpoint; HOST-level kinds (`cpu` |
  // `dbpool`) ramp the reported process resource metrics for the AI EARLY
  // WARNING card. Body: { kind?, service?, endpoint?, rampSeconds?,
  // maxExtraLatencyMs?, maxErrorRatio?, minHostPct?, maxHostPct? }.
  app.post('/__control/degrade', (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;

    const rawKind = b.kind;
    const kind: DegradeKind | null =
      rawKind === undefined || rawKind === 'latency'
        ? 'latency'
        : rawKind === 'errors' ||
            rawKind === 'cpu' ||
            rawKind === 'dbpool'
          ? (rawKind as DegradeKind)
          : null;
    if (kind === null) {
      return res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'kind must be "latency", "errors", "cpu", or "dbpool"',
        },
      });
    }

    const minHostPct = clampPct(numOr(b.minHostPct, DEGRADE_DEFAULTS.minHostPct));
    const maxHostPct = clampPct(numOr(b.maxHostPct, DEGRADE_DEFAULTS.maxHostPct));
    const state: DegradeState = {
      service:
        typeof b.service === 'string' && b.service.length > 0
          ? b.service
          : DEGRADE_DEFAULTS.service,
      endpoint:
        typeof b.endpoint === 'string' ? b.endpoint : DEGRADE_DEFAULTS.endpoint,
      kind,
      rampSeconds: Math.max(0, numOr(b.rampSeconds, DEGRADE_DEFAULTS.rampSeconds)),
      startedAt: Date.now(),
      maxExtraLatencyMs: Math.max(
        0,
        numOr(b.maxExtraLatencyMs, DEGRADE_DEFAULTS.maxExtraLatencyMs),
      ),
      maxErrorRatio: Math.min(1, Math.max(0, numOr(b.maxErrorRatio, DEGRADE_DEFAULTS.maxErrorRatio))),
      // Keep floor ≤ ceiling so the ramp always climbs (or holds), never inverts.
      minHostPct: Math.min(minHostPct, maxHostPct),
      maxHostPct: Math.max(minHostPct, maxHostPct),
    };
    setDegrade(state);
    return res.status(200).json({ ok: true, degrade: state });
  });

  // Clear any active degradation (recovery step).
  app.post('/__control/degrade/clear', (_req: Request, res: Response) => {
    clearDegrade();
    return res.status(200).json({ ok: true, degrade: null });
  });

  app.get('/__control/state', (_req: Request, res: Response) => {
    return res.status(200).json({
      mode: activeMode,
      deployed_sha: deployedShaFor(activeMode),
      degrade: activeDegrade,
    });
  });
}
