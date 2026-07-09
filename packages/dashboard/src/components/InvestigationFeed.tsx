import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  YAxis,
} from 'recharts';
import {
  Sparkles,
  Terminal,
  Database,
  Flag,
  AlertTriangle,
  ChevronDown,
  Loader2,
  ArrowDown,
  GitPullRequest,
  ExternalLink,
  Play,
} from 'lucide-react';
import type {
  Step,
  StepType,
  SessionStartedData,
  SessionCompletedData,
  ConclusionData,
  EvidenceRef,
  Session,
} from '@oncall/shared';
import { apiUrl } from '../api/client';
import { investigateIncident } from '../api/incidents';
import { useEventStream } from '../sse/useEventStream';
import { useReportLive } from '../state/LiveContext';
import { useReducedMotion } from '../hooks/useMediaQuery';
import { relativeTime, absoluteTime, pct, ms } from '../lib/format';
import { v, tint } from '../lib/tokens';
import { Card, CardHeader } from './primitives/Card';
import { Icon } from './primitives/Icon';
import { Chip } from './primitives/Badge';
import { ConnectionStatus } from './primitives/ConnectionStatus';
import { CodeBlock } from './primitives/CodeBlock';
import { Skeleton } from './primitives/Skeleton';
import { Button } from './primitives/Button';
import { Meter } from './primitives/Meter';

/**
 * InvestigationFeed (DESIGN_SPEC §8.5, NFR-06 — the hero). Subscribes to
 * `GET /incidents/:id/feed` SSE via `useEventStream` (replay-then-live). Renders
 * each step by type (thought / tool_call / tool_result / conclusion / error) with
 * typed tool-result previews + "Show raw"/"Show input" disclosures, session banners,
 * autoscroll + "New steps" jump pill, and the shared ConnectionStatus.
 */
export function InvestigationFeed({
  incidentId,
  initialSteps,
  initialSession,
  loading = false,
  onLiveUpdate,
}: {
  incidentId: string;
  initialSteps?: Step[];
  initialSession?: Session | null;
  loading?: boolean;
  /** Fires on pr_created / conclusion / session_completed so the parent refetches detail. */
  onLiveUpdate?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [newCount, setNewCount] = useState(0);

  const [session, setSession] = useState<SessionStartedData | null>(
    initialSession
      ? {
          session_id: initialSession.id,
          mode: initialSession.mode,
          model: initialSession.model,
        }
      : null,
  );
  const [completed, setCompleted] = useState<SessionCompletedData | null>(
    initialSession && initialSession.status !== 'running'
      ? {
          status: initialSession.status,
          cost_usd: initialSession.cost_usd,
          iterations: initialSession.iterations,
        }
      : null,
  );
  const [feedError, setFeedError] = useState<string | null>(null);
  const [replayBoundary, setReplayBoundary] = useState<number | null>(null);

  // seq → step, deduped across replay + live.
  const stepsMap = useRef<Map<number, Step>>(new Map());
  const [steps, setSteps] = useState<Step[]>([]);

  const seedSteps = useCallback((incoming: Step[]) => {
    for (const s of incoming) {
      const key = s.seq ?? stepsMap.current.size + 1;
      stepsMap.current.set(key, s);
    }
    setSteps([...stepsMap.current.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)));
  }, []);

  // Seed once from the parent's detail fetch so there's no flash before SSE opens.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (initialSteps && initialSteps.length > 0) {
      seededRef.current = true;
      seedSteps(initialSteps);
    }
  }, [initialSteps, seedSteps]);

  const appendStep = useCallback(
    (s: Step) => {
      const key = s.seq ?? stepsMap.current.size + 1;
      const isNew = !stepsMap.current.has(key);
      stepsMap.current.set(key, s);
      setSteps([...stepsMap.current.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)));
      if (isNew) {
        setFollowing((f) => {
          if (!f) setNewCount((n) => n + 1);
          return f;
        });
      }
    },
    [],
  );

  // ── SSE handlers ──────────────────────────────────────────────────────────
  const handlers = useMemo(
    () => ({
      session_started: (d: unknown) => setSession(d as SessionStartedData),
      replay: (d: unknown) => {
        const data = d as { steps?: Step[] };
        const arr = data.steps ?? [];
        if (arr.length > 0) {
          seedSteps(arr);
          const maxSeq = Math.max(...arr.map((s) => s.seq ?? 0));
          setReplayBoundary(maxSeq);
        }
      },
      step: (d: unknown) => appendStep(d as Step),
      pr_created: () => {
        // The inline PR chip is rendered from the create_fix_pr tool_result step;
        // this event just refreshes the aside PRCard via the parent.
        onLiveUpdate?.();
      },
      conclusion: () => {
        onLiveUpdate?.();
      },
      session_completed: (d: unknown) => {
        setCompleted(d as SessionCompletedData);
        onLiveUpdate?.();
      },
      // NB: EventSource's native connection-error event is also named "error", so
      // this handler fires on reconnects too (with no `data`). Only surface a real
      // server-sent `event: error` frame (a parsed object carrying a message).
      error: (d: unknown) => {
        if (d && typeof d === 'object' && 'message' in d) {
          setFeedError(String((d as { message?: unknown }).message) || 'Investigation error');
        }
      },
    }),
    [appendStep, seedSteps, onLiveUpdate],
  );

  const feedUrl = useMemo(
    () => apiUrl(`/incidents/${encodeURIComponent(incidentId)}/feed`),
    [incidentId],
  );
  // Stop the stream once the session is completed — no more steps will arrive.
  const { status, retry } = useEventStream(feedUrl, {
    events: handlers,
    enabled: completed == null,
  });
  useReportLive(`feed-${incidentId}`, completed == null ? status : 'closed');

  // ── Autoscroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!following) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps, following]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setFollowing(atBottom);
    if (atBottom) setNewCount(0);
  };

  const jumpToLatest = (): void => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    setFollowing(true);
    setNewCount(0);
  };

  // Evidence chip → scroll to the source tool step (§8.5).
  const handleEvidence = useCallback(
    (e: EvidenceRef) => {
      if (!e.tool) return;
      const root = scrollRef.current;
      const target = root?.querySelector<HTMLElement>(`[data-tool="${e.tool}"]`);
      if (target) {
        setFollowing(false);
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        target.classList.add('ring-2', 'ring-accent', 'rounded-md');
        window.setTimeout(
          () => target.classList.remove('ring-2', 'ring-accent', 'rounded-md'),
          1400,
        );
      }
    },
    [reduceMotion],
  );

  const runInvestigation = async (): Promise<void> => {
    try {
      await investigateIncident(incidentId);
      onLiveUpdate?.();
    } catch {
      /* surfaced via the feed error banner on the next tick if it fails */
    }
  };

  const offline = completed == null && (status === 'closed' || status === 'reconnecting');
  const showEmpty = !loading && steps.length === 0 && session == null;
  const showSkeleton = loading && steps.length === 0;

  // Announce the newest step (summary only) to a polite live region (§8.5 a11y).
  const latest = steps[steps.length - 1];
  const liveMsg = latest
    ? `Step ${latest.seq ?? ''}, ${STEP_LABEL[latest.type as StepType] ?? latest.type}${
        latest.tool_name ? `, ${latest.tool_name}` : ''
      }`
    : '';

  return (
    <Card className="flex h-full min-h-0 flex-col" padded={false}>
      <div className="border-b border-border p-4 pb-3 md:p-5 md:pb-3">
        <CardHeader
          title="Investigation"
          className="mb-0"
          icon={
            <span className="text-ink-2">
              <Icon icon={Sparkles} size={18} />
            </span>
          }
          right={
            completed == null ? (
              <ConnectionStatus status={status} onRetry={retry} />
            ) : (
              <span className="text-sm text-ink-muted-text">Investigation complete</span>
            )
          }
        />
      </div>

      {session ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-2 px-4 py-2 text-sm text-ink-2">
          <span className="text-ink">Investigation started</span>
          <Chip>mode {session.mode}</Chip>
          <Chip>model {session.model}</Chip>
        </div>
      ) : null}

      {offline ? (
        <div
          className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm text-ink-2"
          style={{ backgroundColor: tint('warn', 8) }}
        >
          <span>
            {status === 'reconnecting'
              ? 'Reconnecting to the investigation stream…'
              : 'Stream offline — showing persisted steps.'}
          </span>
          <button type="button" onClick={retry} className="font-medium text-accent-text hover:underline">
            Retry
          </button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="feed"
        aria-busy={completed == null}
        aria-label="Investigation steps"
        className="relative min-h-0 flex-1 overflow-y-auto p-4 md:p-5"
      >
        <span className="sr-only" role="status" aria-live="polite">
          {liveMsg}
        </span>

        {showSkeleton ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <StepSkeleton key={i} />
            ))}
          </div>
        ) : showEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="text-ink-muted">
              <Icon icon={Sparkles} size={24} />
            </span>
            <p className="max-w-xs text-body-md font-medium text-ink">
              Investigation will start automatically when an incident opens
            </p>
            <Button
              variant="secondary"
              leadingIcon={<Icon icon={Play} size={16} />}
              onClick={() => void runInvestigation()}
            >
              Run investigation
            </Button>
          </div>
        ) : (
          <ol className="flex flex-col">
            {steps.map((step, i) => (
              <FeedStep
                key={step.seq ?? i}
                step={step}
                isLast={i === steps.length - 1}
                running={isRunning(step, steps, i, completed != null)}
                showReplayDivider={
                  replayBoundary != null &&
                  (step.seq ?? 0) > replayBoundary &&
                  (steps[i - 1]?.seq ?? 0) <= replayBoundary
                }
                onEvidenceClick={handleEvidence}
              />
            ))}
          </ol>
        )}

        {feedError ? (
          <div
            className="mt-2 flex items-start gap-2 rounded-md border-l-2 p-3 text-sm text-ink"
            style={{ borderColor: v('critical'), backgroundColor: tint('critical', 8) }}
          >
            <span className="mt-0.5 shrink-0" style={{ color: v('critical') }}>
              <Icon icon={AlertTriangle} size={16} />
            </span>
            {feedError}
          </div>
        ) : null}

        {newCount > 0 ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="sticky bottom-2 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-pill bg-accent px-3 py-1 text-sm font-medium text-white shadow-elev-2"
          >
            <Icon icon={ArrowDown} size={14} />
            {newCount} new step{newCount > 1 ? 's' : ''}
          </button>
        ) : null}
      </div>

      {completed ? <SessionFooter completed={completed} session={initialSession} /> : null}
    </Card>
  );
}

/* ── Running heuristic ──────────────────────────────────────────────────────*/

function isRunning(step: Step, steps: Step[], index: number, done: boolean): boolean {
  if (done || step.type !== 'tool_call' || !step.tool_name) return false;
  // A call is "running" until a later tool_result for the same tool arrives.
  for (let j = index + 1; j < steps.length; j += 1) {
    if (steps[j].type === 'tool_result' && steps[j].tool_name === step.tool_name) return false;
  }
  return true;
}

/* ── Step type styling ──────────────────────────────────────────────────────*/

const STEP_LABEL: Record<StepType, string> = {
  thought: 'Thinking',
  tool_call: 'Tool call',
  tool_result: 'Result',
  conclusion: 'Conclusion',
  error: 'Error',
};

function stepStyle(type: StepType): { token: string; icon: typeof Sparkles } {
  switch (type) {
    case 'thought':
      return { token: 'ink-muted', icon: Sparkles };
    case 'tool_call':
      return { token: 'accent', icon: Terminal };
    case 'tool_result':
      return { token: 'tool-result', icon: Database };
    case 'conclusion':
      return { token: 'conclusion', icon: Flag };
    case 'error':
      return { token: 'critical', icon: AlertTriangle };
  }
}

/* ── One feed step ──────────────────────────────────────────────────────────*/

function FeedStep({
  step,
  isLast,
  running,
  showReplayDivider,
  onEvidenceClick,
}: {
  step: Step;
  isLast: boolean;
  running: boolean;
  showReplayDivider: boolean;
  onEvidenceClick?: (e: EvidenceRef) => void;
}) {
  const type = step.type as StepType;
  const style = stepStyle(type);
  const ts = step.ts ?? step.created_at ?? undefined;

  return (
    <>
      {showReplayDivider ? (
        <li className="mb-3 flex items-center gap-2 text-label uppercase text-ink-muted-text" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          replayed history above
          <span className="h-px flex-1 bg-border" />
        </li>
      ) : null}
      <li
        id={`step-${step.seq ?? ''}`}
        data-tool={step.tool_name ?? undefined}
        role="article"
        aria-label={`Step ${step.seq ?? ''}, ${STEP_LABEL[type] ?? type}${step.tool_name ? `, ${step.tool_name}` : ''}`}
        className="animate-enter-up flex gap-3 transition-shadow"
      >
        {/* Rail */}
        <div className="flex flex-col items-center">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: tint(style.token, 14), color: v(style.token) }}
          >
            <Icon icon={style.icon} size={14} />
          </span>
          {!isLast ? (
            <span className="my-1 w-0.5 flex-1" style={{ backgroundColor: v('border') }} />
          ) : null}
        </div>

        {/* Content */}
        <div className={`min-w-0 flex-1 ${isLast ? 'pb-1' : 'pb-4'}`}>
          <div className="mb-1 flex items-center gap-2">
            {step.seq != null ? (
              <span className="rounded-sm bg-surface-3 px-1.5 font-mono text-mono-sm text-ink-muted-text">
                {step.seq}
              </span>
            ) : null}
            <span className="text-label uppercase text-ink-muted-text">{STEP_LABEL[type] ?? type}</span>
            {step.tool_name && type !== 'conclusion' ? (
              <Chip className="font-mono">{step.tool_name}</Chip>
            ) : null}
            <span
              className="ml-auto shrink-0 text-sm text-ink-muted-text"
              title={ts != null ? absoluteTime(ts) : undefined}
            >
              {ts != null ? relativeTime(ts) : ''}
            </span>
          </div>

          <StepBody step={step} running={running} onEvidenceClick={onEvidenceClick} />
        </div>
      </li>
    </>
  );
}

function StepBody({
  step,
  running,
  onEvidenceClick,
}: {
  step: Step;
  running: boolean;
  onEvidenceClick?: (e: EvidenceRef) => void;
}) {
  switch (step.type as StepType) {
    case 'thought':
      return (
        <p className="whitespace-pre-wrap text-body text-ink-2">{step.content ?? ''}</p>
      );
    case 'tool_call':
      return <ToolCallBody step={step} running={running} />;
    case 'tool_result':
      return <ToolResultBody step={step} />;
    case 'conclusion':
      return <ConclusionBody step={step} onEvidenceClick={onEvidenceClick} />;
    case 'error':
      return (
        <div
          className="rounded-md border-l-2 p-2.5 text-sm text-ink"
          style={{ borderColor: v('critical'), backgroundColor: tint('critical', 8) }}
        >
          {step.content ?? 'Step error'}
        </div>
      );
  }
}

/* ── tool_call ──────────────────────────────────────────────────────────────*/

function ToolCallBody({ step, running }: { step: Step; running: boolean }) {
  const input = step.tool_input as Record<string, unknown> | null | undefined;
  const entries = input && typeof input === 'object' ? Object.entries(input) : [];
  const compact = entries.filter(([, val]) => typeof val !== 'object' || val === null);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-body text-ink-2">
        Called <code className="font-mono text-ink">{step.tool_name}</code>
      </div>
      {compact.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-mono-sm text-ink-2">
          {compact.slice(0, 6).map(([k, val]) => (
            <span key={k}>
              <span className="text-ink-muted-text">{k}=</span>
              {String(val)}
            </span>
          ))}
        </div>
      ) : null}
      {running ? (
        <div className="flex items-center gap-1.5 text-sm text-ink-muted-text">
          <Icon icon={Loader2} size={14} className="animate-spin" />
          running…
        </div>
      ) : null}
      {input && entries.length > 0 ? (
        <Disclosure label="Show input">
          <CodeBlock code={safeJson(input)} maxHeight={240} />
        </Disclosure>
      ) : null}
    </div>
  );
}

/* ── tool_result (typed previews) ───────────────────────────────────────────*/

function ToolResultBody({ step }: { step: Step }) {
  const out = step.tool_output as Record<string, unknown> | null | undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-body text-ink-2">
        Result · <code className="font-mono text-ink">{step.tool_name}</code>
      </div>
      <ToolResultPreview tool={step.tool_name ?? ''} out={out} />
      {out ? (
        <Disclosure label="Show raw">
          <CodeBlock code={safeJson(out)} maxHeight={280} />
        </Disclosure>
      ) : null}
    </div>
  );
}

function ToolResultPreview({
  tool,
  out,
}: {
  tool: string;
  out: Record<string, unknown> | null | undefined;
}) {
  if (!out) return null;

  if (tool === 'get_metrics') {
    const current = out.current as Record<string, number> | undefined;
    const baseline = out.baseline as Record<string, number> | undefined;
    const series = (out.series as Array<{ ts: number; error_rate: number }>) ?? [];
    return (
      <div className="rounded-md bg-surface-2 p-2.5">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="tabular text-h3 font-semibold text-ink">
              {current ? pct(current.error_rate) : '—'}
            </span>
            <span className="text-label uppercase text-ink-muted-text">
              error rate {baseline ? `· base ${pct(baseline.error_rate)}` : ''}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="tabular text-h3 font-semibold text-ink">
              {current ? ms(current.p95_ms) : '—'}
            </span>
            <span className="text-label uppercase text-ink-muted-text">p95</span>
          </div>
          <div className="ml-auto h-12 w-28">
            <Sparkline points={series} />
          </div>
        </div>
      </div>
    );
  }

  if (tool === 'search_logs') {
    const total = (out.total_matched as number) ?? 0;
    const returned = (out.returned as number) ?? 0;
    const events = (out.events as Array<Record<string, unknown>>) ?? [];
    const patterns = (out.patterns as Array<{ signature: string; count: number }>) ?? [];
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-ink-muted-text">
          {total} matched · {returned} shown
        </span>
        <div className="flex flex-col gap-0.5 rounded-md bg-surface-2 p-2 font-mono text-mono-sm">
          {events.slice(0, 4).map((e, i) => (
            <div key={i} className="flex items-center gap-2 truncate">
              <span className="shrink-0" style={{ color: v(e.level === 'error' ? 'critical' : e.level === 'warn' ? 'warn' : 'ink-muted') }}>
                {String(e.level ?? '')}
              </span>
              <span className="truncate text-ink-2">{String(e.message ?? '')}</span>
            </div>
          ))}
          {events.length === 0 ? <span className="text-ink-muted-text">no log lines</span> : null}
        </div>
        {patterns.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {patterns.slice(0, 6).map((p, i) => (
              <Chip key={i} title={p.signature}>
                <span className="max-w-[180px] truncate">{p.signature}</span>
                <span className="ml-1 text-ink-muted-text">×{p.count}</span>
              </Chip>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (tool === 'get_recent_deploys') {
    const deploys = (out.deploys as Array<Record<string, unknown>>) ?? [];
    return (
      <div className="flex flex-col gap-1 rounded-md bg-surface-2 p-2">
        {deploys.slice(0, 6).map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-mono-sm">
            <code className="shrink-0 text-ink-muted-text">{String(d.short_sha ?? '')}</code>
            <span className="min-w-0 flex-1 truncate text-ink-2">
              {String(d.message_first_line ?? '')}
            </span>
            {d.is_current ? (
              <span
                className="shrink-0 rounded-pill px-1.5 text-label uppercase text-ink"
                style={{ backgroundColor: tint('accent', 14) }}
              >
                current
              </span>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  if (tool === 'get_deploy_diff') {
    const files = (out.files as Array<Record<string, unknown>>) ?? [];
    const adds = (out.total_additions as number) ?? 0;
    const dels = (out.total_deletions as number) ?? 0;
    const nFiles = (out.total_files as number) ?? files.length;
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-ink-muted-text tabular">
          {nFiles} file{nFiles === 1 ? '' : 's'} ·{' '}
          <span style={{ color: v('ok') }}>+{adds}</span>{' '}
          <span style={{ color: v('critical') }}>−{dels}</span>
        </span>
        {files.slice(0, 8).map((f, i) => (
          <DiffFile key={i} file={f} />
        ))}
      </div>
    );
  }

  if (tool === 'read_file') {
    const path = String(out.path ?? '');
    const total = (out.total_lines as number) ?? 0;
    const returned = (out.returned_lines as number) ?? 0;
    const content = String(out.content ?? '');
    return (
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-mono-sm text-ink-2">
          {path} <span className="text-ink-muted-text">· {returned}/{total} lines</span>
        </span>
        {content ? <CodeBlock code={content} maxHeight={220} /> : null}
      </div>
    );
  }

  if (tool === 'create_fix_pr') {
    const number = out.pr_number as number | undefined;
    const url = out.url as string | undefined;
    if (number == null || !url) return null;
    return <InlinePrChip number={number} url={url} />;
  }

  return null;
}

function DiffFile({ file }: { file: Record<string, unknown> }) {
  const patch = typeof file.patch_excerpt === 'string' ? file.patch_excerpt : '';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-mono-sm">
        <span className="min-w-0 flex-1 truncate text-ink-2">{String(file.path ?? '')}</span>
        <span className="tabular shrink-0" style={{ color: v('ok') }}>
          +{(file.additions as number) ?? 0}
        </span>
        <span className="tabular shrink-0" style={{ color: v('critical') }}>
          −{(file.deletions as number) ?? 0}
        </span>
        <span className="shrink-0 text-ink-muted-text">{String(file.status ?? '')}</span>
      </div>
      {patch ? (
        <Disclosure label="Show patch">
          <CodeBlock code={patch} maxHeight={220} />
        </Disclosure>
      ) : null}
    </div>
  );
}

function InlinePrChip({ number, url }: { number: number; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm font-medium text-accent-text hover:bg-surface-3"
    >
      <Icon icon={GitPullRequest} size={14} />
      PR #{number}
      <Icon icon={ExternalLink} size={13} />
    </a>
  );
}

/* ── conclusion ─────────────────────────────────────────────────────────────*/

function ConclusionBody({
  step,
  onEvidenceClick,
}: {
  step: Step;
  onEvidenceClick?: (e: EvidenceRef) => void;
}) {
  const input = step.tool_input as Partial<ConclusionData & { evidence?: EvidenceRef[] }> | null | undefined;
  const rootCause = input?.root_cause ?? step.content ?? '';
  const confidence = input?.confidence ?? null;
  const decision = input?.decision ?? null;
  const evidence = (input?.evidence as EvidenceRef[] | undefined) ?? [];

  return (
    <div
      className="rounded-md border-l-2 bg-surface-2 p-3"
      style={{ borderColor: v('conclusion') }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-label uppercase text-ink-muted-text">Root cause</span>
        {decision ? (
          <span
            className="rounded-pill px-2 py-0.5 text-label uppercase text-ink"
            style={{ backgroundColor: tint(decision === 'propose_fix' ? 'accent' : 'serious', 14) }}
          >
            {decision === 'propose_fix' ? 'Propose fix' : 'Escalate'}
          </span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-body-md text-ink">{rootCause}</p>
      {confidence != null ? <Meter confidence={confidence} className="mt-2" /> : null}
      {evidence.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {evidence.map((e, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onEvidenceClick?.(e)}
              title={e.ref}
              className="inline-flex max-w-[240px] items-center gap-1 rounded-sm bg-surface-3 px-1.5 py-0.5 text-mono-sm text-accent-text hover:underline"
            >
              <span className="truncate">
                {e.tool ?? e.type}
                {e.ref ? ` · ${e.ref}` : ''}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── session footer ─────────────────────────────────────────────────────────*/

function SessionFooter({
  completed,
  session,
}: {
  completed: SessionCompletedData;
  session?: Session | null;
}) {
  const statusToken =
    completed.status === 'completed'
      ? 'ok'
      : completed.status === 'escalated'
        ? 'serious'
        : 'critical';
  const statusLabel =
    completed.status === 'completed'
      ? 'Completed'
      : completed.status === 'escalated'
        ? 'Escalated'
        : completed.status === 'failed'
          ? 'Failed'
          : 'Running';
  const duration =
    session?.started_at && session?.completed_at
      ? Math.max(0, Math.round((session.completed_at - session.started_at) / 1000))
      : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-surface-2 px-4 py-2.5 text-sm text-ink-2">
      <span
        className="inline-flex h-6 items-center gap-1.5 rounded-pill px-2.5 font-medium text-ink"
        style={{ backgroundColor: tint(statusToken, 14) }}
      >
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: v(statusToken) }} />
        {statusLabel}
      </span>
      <span className="tabular">{completed.iterations} iterations</span>
      {completed.cost_usd > 0 ? (
        <span className="tabular">${completed.cost_usd.toFixed(2)}</span>
      ) : null}
      {duration != null ? <span className="tabular">{duration}s</span> : null}
    </div>
  );
}

/* ── shared bits ────────────────────────────────────────────────────────────*/

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
      >
        <Icon icon={ChevronDown} size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        {open ? label.replace('Show', 'Hide') : label}
      </button>
      {open ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}

function Sparkline({ points }: { points: Array<{ ts: number; error_rate: number }> }) {
  if (points.length < 2) return <div className="h-full w-full rounded-sm bg-surface-3" aria-hidden="true" />;
  const data = points.map((p) => ({ ts: p.ts, error_rate: p.error_rate }));
  const max = Math.max(0.05, ...points.map((p) => p.error_rate));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-error)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--series-error)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={[0, max]} />
        <Area
          type="monotone"
          dataKey="error_rate"
          stroke="var(--series-error)"
          strokeWidth={2}
          fill="url(#spark-fill)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function StepSkeleton() {
  return (
    <div className="flex gap-3">
      <Skeleton className="h-7 w-7" rounded="rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-4 w-full" />
        <Skeleton className="mt-1.5 h-4 w-3/4" />
      </div>
    </div>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
