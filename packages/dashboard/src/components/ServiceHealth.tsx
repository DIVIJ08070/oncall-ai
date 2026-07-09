import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CircleSlash, Plug } from 'lucide-react';
import type { ServiceHealth as ServiceHealthDto } from '@oncall/shared';
import { getServices } from '../api';
import { usePolling } from '../hooks/usePolling';
import {
  POLL_INTERVAL_MS,
  ERROR_RATE_THRESHOLD,
  LATENCY_P95_THRESHOLD_MS,
} from '../config';
import { healthStyle } from '../lib/status';
import { pct, ms, perMin, relativeTime, absoluteTime } from '../lib/format';
import { v, tint } from '../lib/tokens';
import { Icon } from './primitives/Icon';
import { StatusPill } from './primitives/Badge';
import { EmptyState } from './primitives/EmptyState';
import { Skeleton } from './primitives/Skeleton';
import { Button } from './primitives/Button';

/**
 * ServiceHealth (DESIGN_SPEC §8.1) — one card per service, polled `GET /services`
 * every 5s. Card = 3px health-color top bar, name + health pill, a 3-stat row
 * (error rate / p95 / req·min, colored on their own breach), a footer (last event
 * + active-incident link). All four states: loading / empty / error / live.
 *
 * `onServicesLoaded` hands the parent the current service list (single poll,
 * no double-fetch); `onSelectService` filters the dashboard to a service.
 */
export function ServiceHealth({
  selectedService,
  onSelectService,
  onServicesLoaded,
}: {
  selectedService: string | null;
  onSelectService: (name: string) => void;
  onServicesLoaded?: (services: ServiceHealthDto[]) => void;
}) {
  const { data, error, loading, refetch } = usePolling(
    (signal) => getServices(signal),
    [],
    { intervalMs: POLL_INTERVAL_MS },
  );

  const services = data?.services ?? [];

  useEffect(() => {
    if (data) onServicesLoaded?.(data.services);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:[grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {[0, 1, 2].map((i) => (
          <ServiceCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-body text-ink-2">
        <span>Couldn&apos;t load services — {error.message}</span>
        <Button variant="ghost" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          icon={Plug}
          title="No services connected"
          subtitle="Ship logs from your app to see health, metrics and incidents here."
          action={
            <Link to="/onboarding">
              <Button variant="primary" leadingIcon={<Icon icon={Plug} size={16} />}>
                Connect a service
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:[grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
      {services.map((svc) => (
        <ServiceCard
          key={svc.name}
          svc={svc}
          selected={svc.name === selectedService}
          onSelect={() => onSelectService(svc.name)}
        />
      ))}
    </div>
  );
}

function ServiceCard({
  svc,
  selected,
  onSelect,
}: {
  svc: ServiceHealthDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const health = healthStyle(svc.health);
  const isSilent = svc.health === 'silent';
  const errorBreach = svc.error_rate >= ERROR_RATE_THRESHOLD;
  const latencyBreach = svc.p95_ms >= LATENCY_P95_THRESHOLD_MS;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-surface text-left shadow-elev-1 transition-shadow duration-fast hover:shadow-elev-2 ${
        selected ? 'border-accent' : 'border-border'
      }`}
    >
      {/* 3px health-color top bar */}
      <span
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ backgroundColor: v(health.token) }}
      />

      <div className="flex items-center justify-between gap-2 p-4 pb-3 pt-4">
        <h3 className="truncate text-h3 font-semibold text-ink">{svc.name}</h3>
        <StatusPill
          token={health.token}
          label={health.label}
          icon={
            isSilent ? (
              <span style={{ color: v('silent') }}>
                <Icon icon={CircleSlash} size={13} />
              </span>
            ) : undefined
          }
        />
      </div>

      {isSilent ? (
        <div className="flex items-center gap-2 px-4 pb-4 text-sm text-ink-muted-text">
          <Icon icon={CircleSlash} size={16} />
          No signal for 60s+
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 px-4 pb-3">
          <Stat
            caption="Error rate"
            value={pct(svc.error_rate)}
            color={errorBreach ? v('critical') : undefined}
          />
          <Stat
            caption="p95"
            value={ms(svc.p95_ms)}
            color={latencyBreach ? v('warn') : undefined}
          />
          <Stat caption="Req/min" value={perMin(svc.req_per_min)} />
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-border px-4 py-2.5">
        <span
          className="text-sm text-ink-muted-text"
          title={absoluteTime(svc.last_event_at)}
        >
          {svc.last_event_at ? relativeTime(svc.last_event_at) : 'no events yet'}
        </span>
        {svc.active_incident_id ? (
          <Link
            to={`/incidents/${svc.active_incident_id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded px-1 text-sm font-medium"
            style={{ color: v('critical') }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: v('critical') }}
            />
            Active incident
          </Link>
        ) : null}
      </div>
    </button>
  );
}

function Stat({
  caption,
  value,
  color,
}: {
  caption: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="tabular text-h2 font-semibold text-ink"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
      <span className="text-label uppercase text-ink-muted-text">{caption}</span>
    </div>
  );
}

function ServiceCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4" style={{ background: tint('surface-3', 30) }}>
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-6 w-20" rounded="rounded-pill" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
