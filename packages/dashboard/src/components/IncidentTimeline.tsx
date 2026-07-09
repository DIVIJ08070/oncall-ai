import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Search,
  GitPullRequest,
  GitMerge,
  Activity,
  CheckCircle2,
  ChevronRight,
  Radio,
} from 'lucide-react';
import type {
  IncidentSummary,
  TimelineEntry,
  TimelineKind,
  IncidentStatus,
} from '@oncall/shared';
import { getIncidents } from '../api';
import { usePolling } from '../hooks/usePolling';
import { POLL_INTERVAL_MS } from '../config';
import { severityStyle, incidentStatusStyle } from '../lib/status';
import { relativeTime, absoluteTime, confidencePct } from '../lib/format';
import { v, tint } from '../lib/tokens';
import { Card, CardHeader } from './primitives/Card';
import { Icon } from './primitives/Icon';
import { StatusPill, Chip } from './primitives/Badge';
import { EmptyState } from './primitives/EmptyState';
import { Skeleton } from './primitives/Skeleton';
import { Button } from './primitives/Button';

/**
 * IncidentTimeline — two modes (DESIGN_SPEC §8.4).
 *  - List mode (Dashboard slot + /incidents page): recent incidents from
 *    `GET /incidents`, status filter, severity dot, live pulse on investigating.
 *  - Lifecycle mode (IncidentDetail aside): the incident's `timeline[]` as a
 *    vertical rail, one node per §7.3 event kind.
 */

/* ───────────────────────── List mode ───────────────────────── */

const STATUS_FILTERS: ReadonlyArray<{ label: string; value: string | undefined }> = [
  { label: 'All', value: undefined },
  { label: 'Open', value: 'open' },
  { label: 'Investigating', value: 'investigating' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Escalated', value: 'escalated' },
];

/** In-progress statuses render the pulsing LIVE dot (§8.4). */
const LIVE_STATUSES = new Set<IncidentStatus>([
  'investigating',
  'fix_proposed',
  'awaiting_merge',
  'verifying',
]);

export function IncidentTimelineList({
  scrollMaxHeight,
  service,
}: {
  /** Cap + internal-scroll the list body (dashboard sticky column). */
  scrollMaxHeight?: string;
  service?: string;
}) {
  const [status, setStatus] = useState<string | undefined>(undefined);

  const { data, error, loading, refetch } = usePolling(
    (signal) => getIncidents({ status, service, limit: 50 }, signal),
    [status, service],
    { intervalMs: POLL_INTERVAL_MS },
  );

  const incidents = data?.incidents ?? [];

  return (
    <Card className="flex h-full min-h-0 flex-col" padded={false}>
      <div className="border-b border-border p-4 pb-3 md:p-5 md:pb-3">
        <CardHeader
          title="Incidents"
          icon={
            <span className="text-ink-2">
              <Icon icon={AlertTriangle} size={18} />
            </span>
          }
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter incidents by status">
          {STATUS_FILTERS.map((f) => {
            const active = f.value === status;
            return (
              <button
                key={f.label}
                type="button"
                onClick={() => setStatus(f.value)}
                aria-pressed={active}
                className={`h-7 rounded-pill px-2.5 text-sm font-medium transition-colors duration-fast ${
                  active
                    ? 'bg-surface-3 text-ink'
                    : 'text-ink-2 hover:bg-surface-3 hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={scrollMaxHeight ? { maxHeight: scrollMaxHeight } : undefined}
      >
        {loading ? (
          <div className="flex flex-col">
            {Array.from({ length: 4 }).map((_, i) => (
              <IncidentRowSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-ink-2">
            Couldn&apos;t load incidents — {error.message}
            <Button variant="ghost" onClick={refetch}>
              Retry
            </Button>
          </div>
        ) : incidents.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            iconToken="ok"
            title="All clear — no incidents"
            subtitle="OnCall AI opens an incident automatically when a threshold breaches."
          />
        ) : (
          <ul>
            {incidents.map((inc) => (
              <IncidentRow key={inc.id} inc={inc} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function IncidentRow({ inc }: { inc: IncidentSummary }) {
  const sev = severityStyle(inc.severity);
  const st = incidentStatusStyle(inc.status);
  const live = LIVE_STATUSES.has(inc.status);

  return (
    <li>
      <Link
        to={`/incidents/${inc.id}`}
        className="flex items-center gap-3 border-b border-border px-4 py-3 hover:bg-surface-3"
      >
        <span
          className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: v(sev.token) }}
          title={`${sev.label} severity`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-body-md font-medium text-ink">
              {inc.title}
            </span>
            <Chip className="shrink-0">{inc.service}</Chip>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusPill token={st.token} label={st.label} />
            {live ? (
              <span className="inline-flex items-center gap-1 text-sm text-ink-muted-text">
                <span
                  className="h-1.5 w-1.5 rounded-full animate-pulse-live"
                  style={{ backgroundColor: v('accent') }}
                />
                <Icon icon={Radio} size={12} className="text-accent" />
              </span>
            ) : null}
            <span
              className="text-sm text-ink-muted-text"
              title={absoluteTime(inc.opened_at)}
            >
              {relativeTime(inc.opened_at)}
            </span>
            {inc.confidence != null ? (
              <span className="tabular text-sm text-ink-muted-text">
                {confidencePct(inc.confidence)} conf
              </span>
            ) : null}
          </div>
        </div>
        <span className="shrink-0 text-ink-muted-text">
          <Icon icon={ChevronRight} size={18} />
        </span>
      </Link>
    </li>
  );
}

function IncidentRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <Skeleton className="h-2.5 w-2.5" rounded="rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-4 w-2/3" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-5 w-20" rounded="rounded-pill" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── Lifecycle mode ─────────────────────── */

interface KindStyle {
  token: string;
  icon: typeof AlertTriangle;
}

function kindStyle(kind: TimelineKind): KindStyle {
  switch (kind) {
    case 'detected':
      return { token: 'critical', icon: AlertTriangle };
    case 'investigating':
      return { token: 'accent', icon: Search };
    case 'pr_opened':
      return { token: 'accent', icon: GitPullRequest };
    case 'merged':
      return { token: 'pr-merged', icon: GitMerge };
    case 'verifying':
      return { token: 'warn', icon: Activity };
    case 'resolved':
      return { token: 'ok', icon: CheckCircle2 };
    case 'escalated':
      return { token: 'serious', icon: AlertTriangle };
  }
}

/** Non-terminal incident statuses → the last timeline node is "current" (pulsing). */
const TERMINAL_STATUSES = new Set<IncidentStatus>(['resolved', 'closed', 'escalated']);

export function IncidentLifecycle({
  timeline,
  status,
}: {
  timeline: TimelineEntry[];
  status: IncidentStatus;
}) {
  if (timeline.length === 0) {
    return (
      <p className="text-sm text-ink-muted-text">
        No lifecycle events yet — the timeline fills as the incident progresses.
      </p>
    );
  }

  const lastIndex = timeline.length - 1;
  const inProgress = !TERMINAL_STATUSES.has(status);

  return (
    <ol className="flex flex-col">
      {timeline.map((entry, i) => {
        const style = kindStyle(entry.kind);
        const isCurrent = i === lastIndex && inProgress;
        const isLast = i === lastIndex;
        return (
          <li key={`${entry.kind}-${entry.ts}-${i}`} className="flex gap-3">
            {/* Rail: node + connector */}
            <div className="flex flex-col items-center">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  isCurrent ? 'animate-pulse-live' : ''
                }`}
                style={{
                  backgroundColor: tint(style.token, 14),
                  boxShadow: isCurrent ? `0 0 0 2px ${v(style.token)}` : undefined,
                  color: v(style.token),
                }}
              >
                <Icon icon={style.icon} size={13} />
              </span>
              {!isLast ? (
                <span className="my-0.5 w-0.5 flex-1" style={{ backgroundColor: v('border') }} />
              ) : null}
            </div>
            {/* Content */}
            <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-4'}`}>
              <div className="text-body-md font-medium text-ink">{entry.label}</div>
              <div className="text-sm text-ink-muted-text" title={absoluteTime(entry.ts)}>
                {relativeTime(entry.ts)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
