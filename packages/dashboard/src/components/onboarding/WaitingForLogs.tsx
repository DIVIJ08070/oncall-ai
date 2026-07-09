import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, CheckCircle2, ArrowRight } from 'lucide-react';
import type { RepoRef, ServiceHealth as ServiceHealthDto } from '@oncall/shared';
import { getServices } from '../../api';
import { usePolling } from '../../hooks/usePolling';
import { healthStyle } from '../../lib/status';
import { relativeTime, absoluteTime } from '../../lib/format';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { StatusPill } from '../primitives/Badge';
import { v } from '../../lib/tokens';

/** Poll cadence for the "waiting for first log" listener (DESIGN_SPEC §6.1 — 3s). */
const WAIT_POLL_MS = 3000;

/**
 * Step 4 — Waiting for first log → Connected (DESIGN_SPEC §6.1). Polls
 * `GET /services` every 3s; a pulsing `radio` icon + "Listening…" until a service
 * reports events (`last_event_at` set). On the first event it transitions to the
 * **Connected** state: `check-circle` `--ok`, "Connected — logs flowing", the
 * service health badge, and a primary "Go to dashboard" → `/`.
 */
export function WaitingForLogs({ repo }: { repo: RepoRef | null }) {
  const [connected, setConnected] = useState(false);

  const { data } = usePolling((signal) => getServices(signal), [], {
    intervalMs: WAIT_POLL_MS,
    enabled: !connected,
  });

  // First service that has actually shipped an event → "connected".
  const liveService: ServiceHealthDto | undefined = data?.services.find(
    (s) => s.last_event_at != null,
  );

  useEffect(() => {
    if (liveService && !connected) setConnected(true);
  }, [liveService, connected]);

  if (connected && liveService) {
    return <Connected service={liveService} />;
  }

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center" aria-live="polite">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-pill"
        style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)' }}
      >
        <span className="animate-pulse-live" style={{ color: v('accent') }}>
          <Icon icon={Radio} size={24} />
        </span>
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-md font-medium text-ink">
          Listening for events from your service…
        </p>
        <p className="max-w-xs text-sm text-ink-2">
          {repo ? (
            <>
              Watching for the first log from{' '}
              <span className="font-medium text-ink">
                {repo.owner}/{repo.repo}
              </span>
              . Deploy or restart your service if you haven&apos;t yet.
            </>
          ) : (
            'Deploy or restart your service so it ships its first log.'
          )}
        </p>
      </div>
      <Link to="/" className="text-sm font-medium text-accent-text hover:underline">
        Skip to dashboard
      </Link>
    </div>
  );
}

function Connected({ service }: { service: ServiceHealthDto }) {
  const health = healthStyle(service.health);
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-pill"
        style={{ backgroundColor: 'color-mix(in srgb, var(--ok) 14%, transparent)' }}
      >
        <span style={{ color: v('ok') }}>
          <Icon icon={CheckCircle2} size={24} />
        </span>
      </span>
      <div className="flex flex-col items-center gap-2">
        <p className="text-h2 font-semibold text-ink">Connected — logs flowing</p>
        <div className="flex items-center gap-2">
          <span className="text-body-md font-medium text-ink">{service.name}</span>
          <StatusPill token={health.token} label={health.label} />
        </div>
        <p className="text-sm text-ink-muted-text" title={absoluteTime(service.last_event_at)}>
          Last event {service.last_event_at ? relativeTime(service.last_event_at) : '—'}
        </p>
      </div>
      <Link to="/" className="w-full">
        <Button
          variant="primary"
          className="h-11 w-full"
          leadingIcon={<Icon icon={ArrowRight} size={16} />}
        >
          Go to dashboard
        </Button>
      </Link>
    </div>
  );
}
