/**
 * Demo control plane (SPEC §7.7, §12).
 *
 *   POST /__control/failure-mode  { mode }            -> 200 { mode }
 *   GET  /__control/state                             -> 200 { mode, deployed_sha }
 *
 * `activeMode` is in-memory (flipped without redeploy). `deployed_sha` is the real
 * git SHA the active mode maps to, read from the seed manifest that
 * `scripts/init-victim-repo.ts` records (baseline SHA for `healthy`). Field name is
 * unified with the platform `POST /api/v1/demo/failure-mode` response (BUG-004).
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

  app.get('/__control/state', (_req: Request, res: Response) => {
    return res.status(200).json({
      mode: activeMode,
      deployed_sha: deployedShaFor(activeMode),
    });
  });
}
