import { useMemo } from 'react';
import {
  GitCommit,
  Timer,
  Activity,
  Clock,
  TrendingUp,
  Zap,
  ArrowRight,
  ShieldQuestion,
  RotateCcw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WhatChangedResult, WhatChangedChange, WhatChangedKind } from '@oncall/shared';
import { getWhatChanged } from '../../../api/prevention';
import { usePolling } from '../../../hooks/usePolling';
import { relativeTime, absoluteTime, ms } from '../../../lib/format';
import { v, tint } from '../../../lib/tokens';
import { Card, CardHeader } from '../../../components/primitives/Card';
import { Icon } from '../../../components/primitives/Icon';
import { Chip } from '../../../components/primitives/Badge';
import { Skeleton } from '../../../components/primitives/Skeleton';
import { EngineBadge } from './EngineBadge';

/**
 * WhatChangedPanel (AI PREVENTION Phase 5) — `GET /incidents/:id/what-changed`.
 * Leads with the single most significant change + its correlation with the
 * incident onset, calls out the prime-suspect deploy, then lists every candidate
 * change ranked by correlation (each with a before→after and a strength bar), and
 * closes with the evidence-grounded reasoning. Fetched once per incident (stable
 * post-hoc correlation); a retry affordance covers a transient failure.
 */

const KIND_ICON: Record<WhatChangedKind, LucideIcon> = {
  deploy: GitCommit,
  error_rate: Activity,
  latency: Timer,
  timeout: Clock,
  risk_escalation: TrendingUp,
  throughput: Zap,
};

const KIND_LABEL: Record<WhatChangedKind, string> = {
  deploy: 'deploy',
  error_rate: 'error rate',
  latency: 'latency',
  timeout: 'timeout',
  risk_escalation: 'risk',
  throughput: 'throughput',
};

/** Correlation strength → token: strong=accent, medium=serious, weak=ink-muted. */
function corrToken(pct: number): string {
  if (pct >= 70) return 'accent';
  if (pct >= 40) return 'serious';
  return 'ink-muted';
}

/** Format a before/after metric value with a kind-appropriate unit. */
function fmtValue(kind: WhatChangedKind, value: number): string {
  if (kind === 'latency') return ms(value);
  if (kind === 'error_rate' || kind === 'throughput') {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return String(Math.round(value));
}

export function WhatChangedPanel({ incidentId }: { incidentId: string }) {
  const { data, error, loading, refetch } = usePolling<WhatChangedResult | null>(
    (signal) => getWhatChanged(incidentId, signal),
    [incidentId],
    { enabled: incidentId !== '' },
  );

  const changes = useMemo(
    () => [...(data?.relatedChanges ?? [])].sort((a, b) => b.correlationPct - a.correlationPct),
    [data],
  );

  return (
    <Card>
      <CardHeader
        title="What changed?"
        icon={<Icon icon={GitCommit} size={16} />}
        right={data ? <EngineBadge engine={data.engine} /> : undefined}
      />

      {loading && !data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-16 w-full" rounded="rounded-lg" />
          <Skeleton className="h-10 w-full" rounded="rounded-lg" />
          <Skeleton className="h-10 w-full" rounded="rounded-lg" />
        </div>
      ) : error && !data ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-ink-2">Couldn’t correlate the change — {error.message}</p>
          <button
            type="button"
            onClick={refetch}
            className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
          >
            <Icon icon={RotateCcw} size={14} /> Retry
          </button>
        </div>
      ) : !data ? (
        <p className="text-sm text-ink-muted-text">
          No correlated change found for this incident yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Most significant change + correlation */}
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label uppercase tracking-wide text-ink-2">
                Most significant change
              </span>
              <CorrelationTag pct={data.correlationPct} />
            </div>
            <p className="mt-1.5 text-body-md text-ink">{data.mostSignificantChange}</p>
            {data.lastHealthyAt != null ? (
              <p className="mt-1 text-sm text-ink-muted-text">
                Last healthy{' '}
                <span title={absoluteTime(data.lastHealthyAt)}>
                  {relativeTime(data.lastHealthyAt)}
                </span>
              </p>
            ) : null}
          </div>

          {/* Prime suspect deploy */}
          {data.deploy ? (
            <div
              className="rounded-lg border p-3"
              style={{ borderColor: tint('accent', 40), backgroundColor: tint('accent', 6) }}
            >
              <div className="flex items-center gap-1.5 text-accent-text">
                <Icon icon={GitCommit} size={14} />
                <span className="text-label uppercase tracking-wide">Prime suspect deploy</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Chip
                  className="font-mono !text-mono-sm"
                  title={data.deploy.sha}
                >
                  {data.deploy.shortSha}
                </Chip>
                <span className="text-body text-ink">{data.deploy.message}</span>
              </div>
              <p className="mt-1.5 text-sm text-ink-2">
                {data.deploy.author} ·{' '}
                {data.deploy.minutesBeforeIncident >= 0
                  ? `${data.deploy.minutesBeforeIncident} min before incident`
                  : `${Math.abs(data.deploy.minutesBeforeIncident)} min after onset`}
              </p>
            </div>
          ) : null}

          {/* Ranked candidate changes */}
          {changes.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {changes.map((c, i) => (
                <ChangeRow key={`${c.kind}-${c.ref}-${i}`} change={c} />
              ))}
            </ul>
          ) : null}

          {/* Reasoning */}
          {data.reasoning ? (
            <div className="rounded-lg bg-surface-2 p-3">
              <div className="flex items-center gap-1.5 text-ink-2">
                <Icon icon={ShieldQuestion} size={14} />
                <span className="text-label uppercase tracking-wide">Why this ranking</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-body text-ink-2">{data.reasoning}</p>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function CorrelationTag({ pct }: { pct: number }) {
  const token = corrToken(pct);
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-pill px-2 text-label font-medium tabular-nums text-ink"
      style={{ backgroundColor: tint(token, 16) }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: v(token) }} />
      {Math.round(pct)}% correlated
    </span>
  );
}

function ChangeRow({ change: c }: { change: WhatChangedChange }) {
  const token = corrToken(c.correlationPct);
  const hasDelta = c.before != null && c.after != null;
  return (
    <li className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-ink-2">
            <Icon icon={KIND_ICON[c.kind]} size={15} />
          </span>
          <Chip className="shrink-0">{KIND_LABEL[c.kind]}</Chip>
          <span className="truncate font-mono text-mono-sm text-ink-2" title={c.ref}>
            {c.ref}
          </span>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: v(token) }}>
          {Math.round(c.correlationPct)}%
        </span>
      </div>

      <p className="mt-1 text-sm text-ink">{c.summary}</p>

      <div className="mt-1.5 flex items-center gap-2">
        {hasDelta ? (
          <span className="inline-flex items-center gap-1 font-mono text-mono-sm text-ink-2 tabular-nums">
            {fmtValue(c.kind, c.before as number)}
            <Icon icon={ArrowRight} size={12} />
            <span className="text-ink">{fmtValue(c.kind, c.after as number)}</span>
          </span>
        ) : null}
        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-3">
          <div
            className="h-full rounded-pill"
            style={{ width: `${Math.max(0, Math.min(100, c.correlationPct))}%`, backgroundColor: v(token) }}
          />
        </div>
      </div>
    </li>
  );
}
