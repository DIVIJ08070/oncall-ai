import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  GitPullRequest,
  MessageSquare,
  FileText,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import type { Incident, IncidentDetailResponse } from '@oncall/shared';
import { getIncident, getPostmortem, generatePostmortem } from '../api/incidents';
import { usePolling } from '../hooks/usePolling';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { POLL_INTERVAL_MS } from '../config';
import { incidentStatusStyle, severityStyle } from '../lib/status';
import { relativeTime, absoluteTime, pct, ms } from '../lib/format';
import { tint } from '../lib/tokens';
import { IncidentTimelineList, IncidentLifecycle } from '../components/IncidentTimeline';
import { InvestigationFeed } from '../components/InvestigationFeed';
import { PRCard } from '../components/PRCard';
import { ChatPanel } from '../components/ChatPanel';
import { Card, CardHeader } from '../components/primitives/Card';
import { StatusPill, Chip } from '../components/primitives/Badge';
import { Button } from '../components/primitives/Button';
import { Icon } from '../components/primitives/Icon';
import { Meter } from '../components/primitives/Meter';
import { EmptyState } from '../components/primitives/EmptyState';
import { Skeleton } from '../components/primitives/Skeleton';
import { Drawer } from '../components/primitives/Drawer';
import { SegmentedControl } from '../components/primitives/SegmentedControl';

/**
 * `/incidents` list + `/incidents/:id` detail (DESIGN_SPEC §6.3, FR-14/08/16, NFR-06).
 * Detail = sticky header (status/root-cause/confidence), the InvestigationFeed hero
 * (SSE), the aside (Findings + PRCard + lifecycle timeline), and a ChatPanel drawer
 * (bottom sheet on tablet, a segmented tab on mobile).
 */

/* ─────────────────────────── /incidents ─────────────────────────── */

export function IncidentsListPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1 font-semibold text-ink">Incidents</h1>
      <IncidentTimelineList />
    </div>
  );
}

/* ────────────────────────── /incidents/:id ───────────────────────── */

type MobileTab = 'investigation' | 'details' | 'chat';

export function IncidentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const isMobile = useMediaQuery('(max-width: 639px)');
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const [chatOpen, setChatOpen] = useState(false);
  const [pmOpen, setPmOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('investigation');

  const { data, error, loading, refetch } = usePolling<IncidentDetailResponse>(
    (signal) => getIncident(id, signal),
    [id],
    { intervalMs: POLL_INTERVAL_MS, enabled: id !== '' },
  );

  // ── not-found / error (page-level) ──────────────────────────────────────
  if (error && !data) {
    const notFound = 'status' in error && (error as { status?: number }).status === 404;
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Card className="py-6">
          <EmptyState
            icon={AlertTriangle}
            title={notFound ? 'Incident not found' : 'Couldn’t load this incident'}
            subtitle={notFound ? undefined : error.message}
            action={
              notFound ? (
                <Link to="/">
                  <Button variant="primary">Back to dashboard</Button>
                </Link>
              ) : (
                <Button variant="secondary" onClick={refetch}>
                  Retry
                </Button>
              )
            }
          />
        </Card>
      </div>
    );
  }

  if (loading && !data) {
    return <DetailSkeleton />;
  }
  if (!data) return null;

  const { incident, session, steps, pull_request } = data;

  const askAgent = (): void => {
    if (isMobile) setMobileTab('chat');
    else setChatOpen(true);
  };

  const feed = (
    <div className="h-[70vh] min-h-[420px] lg:h-[calc(100vh-210px)]">
      <InvestigationFeed
        incidentId={id}
        initialSteps={steps}
        initialSession={session}
        loading={loading && !data}
        onLiveUpdate={refetch}
      />
    </div>
  );

  const aside = (
    <DetailsAside detail={data} onAskAgent={askAgent} />
  );

  return (
    <div className="flex flex-col gap-4">
      <Header
        incident={incident}
        session={session}
        hasPr={Boolean(pull_request)}
        prUrl={pull_request?.url ?? null}
        onAskAgent={askAgent}
        onPostmortem={() => setPmOpen(true)}
      />

      {/* Mobile: segmented single-panel switch (§6.3) */}
      {isMobile ? (
        <div className="flex flex-col gap-4">
          <SegmentedControl<MobileTab>
            ariaLabel="Incident view"
            value={mobileTab}
            onChange={setMobileTab}
            segments={[
              { value: 'investigation', label: 'Investigation' },
              { value: 'details', label: 'Details' },
              { value: 'chat', label: 'Chat' },
            ]}
          />
          {mobileTab === 'investigation' ? feed : null}
          {mobileTab === 'details' ? aside : null}
          {mobileTab === 'chat' ? (
            <Card className="flex h-[70vh] min-h-[420px] flex-col" padded={false}>
              <ChatPanel incidentId={id} />
            </Card>
          ) : null}
        </div>
      ) : isDesktop ? (
        // Desktop: feed left / aside right (§6.3)
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="min-w-0">{feed}</div>
          <div className="flex min-w-0 flex-col gap-4">{aside}</div>
        </div>
      ) : (
        // Tablet: stacked (§6.3)
        <div className="flex flex-col gap-6">
          {feed}
          {aside}
        </div>
      )}

      {/* Chat drawer (side on desktop, bottom sheet on tablet) */}
      {!isMobile ? (
        <Drawer
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          title="Ask the agent"
          variant={isDesktop ? 'side' : 'sheet'}
        >
          <ChatPanel incidentId={id} />
        </Drawer>
      ) : null}

      {/* Postmortem drawer */}
      <Drawer
        open={pmOpen}
        onClose={() => setPmOpen(false)}
        title="Postmortem"
        variant={isDesktop ? 'side' : 'sheet'}
      >
        <PostmortemBody incidentId={id} open={pmOpen} />
      </Drawer>
    </div>
  );
}

/* ── Header ──────────────────────────────────────────────────────────────── */

function BackLink() {
  return (
    <Link
      to="/incidents"
      className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
    >
      <Icon icon={ArrowLeft} size={16} />
      Incidents
    </Link>
  );
}

function breachSummary(inc: Incident): string | null {
  if (inc.detector === 'error_rate')
    return `err ${pct(inc.observed_value)} ≥ ${pct(inc.threshold_value)}`;
  if (inc.detector === 'latency')
    return `p95 ${ms(inc.observed_value)} ≥ ${ms(inc.threshold_value)}`;
  return null;
}

function Header({
  incident,
  session,
  hasPr,
  prUrl,
  onAskAgent,
  onPostmortem,
}: {
  incident: Incident;
  session: IncidentDetailResponse['session'];
  hasPr: boolean;
  prUrl: string | null;
  onAskAgent: () => void;
  onPostmortem: () => void;
}) {
  const st = incidentStatusStyle(incident.status);
  const sev = severityStyle(incident.severity);
  const breach = breachSummary(incident);
  const rootCause = session?.root_cause ?? incident.root_cause;
  const confidence = session?.confidence ?? incident.confidence;

  return (
    <div className="sticky top-14 z-20 -mx-3 border-b border-border bg-surface px-3 py-3 sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6">
      <BackLink />
      <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h1 font-semibold text-ink">{incident.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill token={st.token} label={st.label} />
            <StatusPill token={sev.token} label={`${sev.label} severity`} />
            <Chip>{incident.service}</Chip>
            <Chip>{incident.detector}</Chip>
            {breach ? (
              <span className="tabular text-sm text-ink-muted-text">{breach}</span>
            ) : null}
            <span
              className="text-sm text-ink-muted-text"
              title={absoluteTime(incident.opened_at)}
            >
              opened {relativeTime(incident.opened_at)}
            </span>
            {incident.resolved_at ? (
              <span
                className="text-sm text-ink-muted-text"
                title={absoluteTime(incident.resolved_at)}
              >
                · resolved {relativeTime(incident.resolved_at)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {hasPr && prUrl ? (
            <a href={prUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" leadingIcon={<Icon icon={GitPullRequest} size={16} />}>
                View PR
              </Button>
            </a>
          ) : null}
          <Button
            variant="secondary"
            leadingIcon={<Icon icon={MessageSquare} size={16} />}
            onClick={onAskAgent}
          >
            Ask agent
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<Icon icon={FileText} size={16} />}
            onClick={onPostmortem}
          >
            Postmortem
          </Button>
        </div>
      </div>

      {rootCause ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="text-body-md text-ink">{rootCause}</p>
          {confidence != null ? (
            <Meter confidence={confidence} className="max-w-xs" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── Aside (Findings + PRCard + lifecycle) ───────────────────────────────── */

function DetailsAside({
  detail,
  onAskAgent,
}: {
  detail: IncidentDetailResponse;
  onAskAgent: () => void;
}) {
  const { incident, session, pull_request, timeline } = detail;
  const rootCause = session?.root_cause ?? incident.root_cause;
  const confidence = session?.confidence ?? incident.confidence;
  const decision = session?.decision ?? null;

  return (
    <>
      <Card>
        <CardHeader title="Findings" />
        {rootCause ? (
          <div className="flex flex-col gap-2">
            {decision ? (
              <span
                className="w-fit rounded-pill px-2 py-0.5 text-label uppercase text-ink"
                style={{ backgroundColor: tint(decision === 'propose_fix' ? 'accent' : 'serious', 14) }}
              >
                {decision === 'propose_fix' ? 'Propose fix' : 'Escalate'}
              </span>
            ) : null}
            <p className="text-body text-ink-2">{rootCause}</p>
            {confidence != null ? <Meter confidence={confidence} /> : null}
          </div>
        ) : (
          <p className="text-sm text-ink-muted-text">
            The agent hasn’t submitted findings yet.
          </p>
        )}
      </Card>

      <PRCard
        pr={pull_request}
        incidentStatus={incident.status}
        onViewFindings={onAskAgent}
      />

      <Card>
        <CardHeader title="Lifecycle" />
        <IncidentLifecycle timeline={timeline} status={incident.status} />
      </Card>
    </>
  );
}

/* ── Postmortem ──────────────────────────────────────────────────────────── */

function PostmortemBody({ incidentId, open }: { incidentId: string; open: boolean }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getPostmortem(incidentId)
      .then((res) => {
        if (!cancelled) {
          setMarkdown(res?.postmortem ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [incidentId, open]);

  const generate = async (): Promise<void> => {
    setGenerating(true);
    try {
      const res = await generatePostmortem(incidentId);
      setMarkdown(res.postmortem);
    } catch {
      /* leave the empty state; user can retry */
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted-text">
        <Icon icon={Loader2} size={20} className="animate-spin" />
      </div>
    );
  }

  if (!markdown) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="text-ink-muted">
          <Icon icon={FileText} size={24} />
        </span>
        <p className="text-body-md font-medium text-ink">No postmortem yet</p>
        <p className="max-w-xs text-sm text-ink-2">
          Generate a draft from the incident timeline, root cause and the proposed fix.
        </p>
        <Button variant="primary" onClick={() => void generate()} disabled={generating}>
          {generating ? 'Generating…' : 'Generate draft'}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <pre className="whitespace-pre-wrap font-mono text-mono-sm text-ink-2">{markdown}</pre>
    </div>
  );
}

/* ── Loading skeleton ────────────────────────────────────────────────────── */

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-2/3" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24" rounded="rounded-pill" />
          <Skeleton className="h-6 w-28" rounded="rounded-pill" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Skeleton className="h-[60vh] w-full" rounded="rounded-lg" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full" rounded="rounded-lg" />
          <Skeleton className="h-48 w-full" rounded="rounded-lg" />
        </div>
      </div>
    </div>
  );
}
