import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, HeartPulse, RotateCcw } from 'lucide-react';
import { GlassCard, MONO } from '../../../components/shell/UnifiedChrome';
import { Entrance } from '../../../components/motion/primitives';
import {
  getHealthReport,
  getLatestHealthReport,
  startHealthReport,
} from '../../../api/healthReport';
import type { HealthReport } from '../../../api/healthReport';
import { getSelectedRepo } from '../../../api';

/** The repo the user connected for incident catching (same source as the
 * Self-Learning page); health opens on THIS repo automatically. */
async function connectedRepoUrl(): Promise<string> {
  const stored = localStorage.getItem('oncall.selfLearning.repo');
  if (stored && /^[\w.-]+\/[\w.-]+$/.test(stored)) {
    return `https://github.com/${stored}`;
  }
  // Follow the repo connected in onboarding (Setup Wizard → select repo).
  const sel = await getSelectedRepo();
  const slug = sel ? `${sel.owner}/${sel.repo}` : 'DIVIJ08070/oncall-ai-victim';
  return `https://github.com/${slug}`;
}
import { StageChecklist } from '../components/StageChecklist';
import { ReportView, repoDisplayName } from '../components/ReportView';

/**
 * ProjectHealthPage (`/health`) — paste a public GitHub repo URL, the server
 * clones + scans it and an AI writes a full health report (async job, 1-3 min).
 * Four phases: idle form → running checklist (poll every 2.5s) → report grid,
 * or a soft error card with retry.
 */

const POLL_MS = 2500;
/** Consecutive poll failures tolerated before giving up (transient blips are fine). */
const MAX_POLL_FAILURES = 5;

const REPO_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(?:\.git)?\/?$/;

type Phase =
  | { kind: 'boot' }
  | { kind: 'idle' }
  | { kind: 'starting'; repoUrl: string }
  | { kind: 'running'; id: string; repoUrl: string; startedAt: number }
  | { kind: 'done'; repoUrl: string; report: HealthReport }
  | { kind: 'error'; repoUrl: string; message: string };

export function ProjectHealthPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'boot' });
  const [connectedUrl, setConnectedUrl] = useState<string | null>(null);

  /* boot: resolve the connected repo (onboarding-selected), then show its
     latest report or analyze it now */
  useEffect(() => {
    if (phase.kind !== 'boot') return;
    let alive = true;
    void connectedRepoUrl().then((repoUrl) => {
      if (!alive) return;
      setConnectedUrl(repoUrl);
      getLatestHealthReport(repoUrl)
        .then((job) => {
          if (!alive) return;
          if (job.status === 'done' && job.report) {
            setPhase({ kind: 'done', repoUrl, report: job.report });
          } else {
            void start(repoUrl);
          }
        })
        .catch(() => {
          if (alive) void start(repoUrl);
        });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind]);

  const start = async (repoUrl: string): Promise<void> => {
    setPhase({ kind: 'starting', repoUrl });
    try {
      const res = await startHealthReport(repoUrl);
      setPhase({ kind: 'running', id: res.id, repoUrl, startedAt: Date.now() });
    } catch (err) {
      setPhase({
        kind: 'error',
        repoUrl,
        message: err instanceof Error ? err.message : 'Could not start the analysis.',
      });
    }
  };

  /* — poll the job while running — */
  const failuresRef = useRef(0);
  useEffect(() => {
    if (phase.kind !== 'running') return;
    failuresRef.current = 0;
    const { id, repoUrl } = phase;
    const controller = new AbortController();
    let cancelled = false;

    const tick = async (): Promise<void> => {
      try {
        const job = await getHealthReport(id, controller.signal);
        if (cancelled) return;
        failuresRef.current = 0;
        if (job.status === 'done' && job.report) {
          setPhase({ kind: 'done', repoUrl, report: job.report });
        } else if (job.status === 'error') {
          setPhase({
            kind: 'error',
            repoUrl,
            message: job.error ?? 'The analysis failed for an unknown reason.',
          });
        }
        // still "running" → keep polling
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        failuresRef.current += 1;
        if (failuresRef.current >= MAX_POLL_FAILURES) {
          setPhase({
            kind: 'error',
            repoUrl,
            message: err instanceof Error ? err.message : 'Lost contact with the server.',
          });
        }
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [phase]);

  const reset = (): void => setPhase({ kind: 'idle' });

  return (
    <Entrance className="flex flex-col gap-5">
      {phase.kind === 'done' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/70"
              style={{ fontFamily: MONO }}
            >
              <HeartPulse className="h-3.5 w-3.5 text-[#FF8233]" />
              {repoDisplayName(phase.repoUrl)}
              {phase.repoUrl === connectedUrl && (
                <span className="text-white/35">· connected repo</span>
              )}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void start(phase.repoUrl)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/70 transition-colors hover:border-[#F16524]/40 hover:text-[#FF8233]"
                style={{ fontFamily: MONO }}
              >
                <RotateCcw className="h-3 w-3" />
                Re-analyze
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/70 transition-colors hover:border-[#F16524]/40 hover:text-[#FF8233]"
                style={{ fontFamily: MONO }}
              >
                Different repo →
              </button>
            </div>
          </div>
          <ReportView report={phase.report} repoUrl={phase.repoUrl} onReset={reset} />
        </>
      ) : phase.kind === 'running' ? (
        <RunningState repoUrl={phase.repoUrl} startedAt={phase.startedAt} />
      ) : phase.kind === 'error' ? (
        <ErrorState
          repoUrl={phase.repoUrl}
          message={phase.message}
          onRetry={() => void start(phase.repoUrl)}
          onReset={reset}
        />
      ) : phase.kind === 'boot' ? (
        <RunningState repoUrl={connectedUrl ?? 'connected repo'} startedAt={Date.now()} bootProbe />
      ) : (
        <IdleState
          busy={phase.kind === 'starting'}
          onSubmit={(url) => void start(url)}
          onBack={() => setPhase({ kind: 'boot' })}
        />
      )}
    </Entrance>
  );
}

/* ── idle (and starting) — the centered form ─────────────────────────────── */

function IdleState({
  busy,
  onSubmit,
  onBack,
}: {
  busy: boolean;
  onSubmit: (repoUrl: string) => void;
  onBack?: () => void;
}) {
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!REPO_URL_RE.test(trimmed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSubmit(trimmed);
  };

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#F16524]/30 bg-[#F16524]/10">
        <HeartPulse className="h-7 w-7 text-[#FF8233]" />
      </span>
      <h1 className="font-playfair text-h1 italic text-ink">Project Health</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-white/50">
        Paste a public GitHub repository and the AI will scan it and write a full
        health report — score, stack, APIs, quality and security.
      </p>

      <form onSubmit={submit} className="mt-7 w-full max-w-xl">
        <GlassCard className="flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="health-repo-url">
            GitHub repository URL
          </label>
          <input
            id="health-repo-url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (invalid) setInvalid(false);
            }}
            placeholder="https://github.com/owner/repo"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            className="h-11 min-w-0 flex-1 rounded-xl bg-transparent px-3.5 text-sm text-[#F5F5F2] placeholder:text-white/30 focus:outline-none disabled:opacity-50"
            style={{ fontFamily: MONO }}
          />
          <button
            type="submit"
            disabled={busy}
            className="h-11 shrink-0 rounded-xl bg-[#F16524] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#FF8233] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Starting…' : 'Analyze project'}
          </button>
        </GlassCard>
        <p
          aria-live="polite"
          className={`mt-2.5 text-[11px] ${invalid ? 'text-[#FF6B61]' : 'text-white/30'}`}
          style={{ fontFamily: MONO }}
        >
          {invalid
            ? 'That doesn’t look like a GitHub repo URL — expected https://github.com/owner/repo'
            : 'public repos only · analysis takes 1–3 minutes'}
        </p>
      </form>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-5 text-[11px] uppercase tracking-[0.16em] text-white/40 transition-colors hover:text-[#FF8233]"
          style={{ fontFamily: MONO }}
        >
          ← back to connected repo
        </button>
      )}
    </div>
  );
}

/* ── running — animated stage checklist ──────────────────────────────────── */

function RunningState({
  repoUrl,
  startedAt,
  bootProbe,
}: {
  repoUrl: string;
  startedAt: number;
  bootProbe?: boolean;
}) {
  if (bootProbe) {
    // brief flash while we check for an existing report of the connected repo
  }
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <p
        className="mb-4 max-w-full truncate text-[11px] uppercase tracking-[0.18em] text-white/40"
        style={{ fontFamily: MONO }}
        title={repoUrl}
      >
        Analyzing · <span className="text-[#FF8233]">{repoDisplayName(repoUrl)}</span>
      </p>
      <StageChecklist startedAt={startedAt} />
    </div>
  );
}

/* ── error — soft red card + retry ───────────────────────────────────────── */

function ErrorState({
  repoUrl,
  message,
  onRetry,
  onReset,
}: {
  repoUrl: string;
  message: string;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#FF3B30]/30 bg-[#FF3B30]/[0.06] p-6 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[#FF6B61]" />
          <span
            className="text-[10px] uppercase tracking-[0.2em] text-[#FF6B61]"
            style={{ fontFamily: MONO }}
          >
            Analysis failed
          </span>
        </div>
        <p
          className="mt-3 truncate text-xs text-white/45"
          style={{ fontFamily: MONO }}
          title={repoUrl}
        >
          {repoDisplayName(repoUrl)}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/70">{message}</p>
        <div className="mt-5 flex items-center gap-2.5">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-xl bg-[#F16524] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#FF8233]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry analysis
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            Start over
          </button>
        </div>
      </div>
    </div>
  );
}
