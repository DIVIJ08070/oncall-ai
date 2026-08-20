import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Activity, GitCommit, Radio, SlidersHorizontal, CheckCircle } from 'lucide-react';
import type { FailureMode } from '@oncall/shared';
import { Icon } from '../primitives/Icon';
import { StatTile, SectionHeader } from '../primitives/StatTile';
import { StatusPill, Chip } from '../primitives/Badge';
import { Card } from '../primitives/Card';
import { Button } from '../primitives/Button';
import { Skeleton } from '../primitives/Skeleton';
import { StaggerGroup, StaggerItem } from '../motion/primitives';
import { v, tint } from '../../lib/tokens';
import { ApiRequestError } from '../../api/client';
import { FailureModeSwitch } from './FailureModeSwitch';
import { CurrentStateReadout } from './CurrentStateReadout';
import { TrafficGenerator, type TrafficStats } from './TrafficGenerator';
import { ToastStack, useToasts } from './Toast';
import { getDemoState, setFailureMode, type DemoState } from './demoApi';
import { metaFor } from './failureModes';

/** Human-readable victim endpoint each traffic target drives. */
const TARGET_LABEL: Record<string, string> = {
  checkout: '/api/checkout',
  reports: '/api/reports',
  pricing: '/api/pricing',
  mix: 'mixed traffic',
};

const TRAFFIC_BLURB =
  'Drive requests at the victim so metrics populate and — under a failing mode — the detector opens an incident within ~15s.';

/**
 * DemoControlPanel (DESIGN_SPEC §6.4/§8.8) — the shared body used by both the `/demo`
 * page (`variant="page"`, SectionHeader bands + StatTile KPI readout) and the dashboard
 * floating launcher (`variant="compact"`, 340px panel). Both wrappers reuse the same
 * victim state (`mode` + `deployed_sha`), the in-flight flip, the lifted traffic stats,
 * and the toast surface, threaded into the FailureModeSwitch, readout, and generator.
 */
export function DemoControlPanel({
  variant = 'compact',
}: {
  variant?: 'compact' | 'page';
} = {}) {
  const [state, setState] = useState<DemoState | null>(null);
  const [pending, setPending] = useState<FailureMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [traffic, setTraffic] = useState<TrafficStats>({ running: false, rate: 40, sent: 0 });
  const { toasts, push } = useToasts();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setLoading(true);
    getDemoState(controller.signal)
      .then((s) => {
        if (!alive.current) return;
        setState(s);
        setError(null);
      })
      .catch((err) => {
        if (!alive.current || (err instanceof DOMException && err.name === 'AbortError')) return;
        setError(
          err instanceof ApiRequestError
            ? err.message
            : 'Could not read demo state — is the victim app running?',
        );
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [nonce]);

  const handleSelect = useCallback(
    (mode: FailureMode) => {
      // Optimistic: reflect the target immediately, confirm on the response.
      setPending(mode);
      setFailureMode(mode)
        .then((res) => {
          if (!alive.current) return;
          setState(res);
          setError(null);
          const meta = metaFor(res.mode);
          const sha = res.deployed_sha ? ` · ${res.deployed_sha.slice(0, 7)}` : '';
          push('success', `Switched to ${meta.label}${sha}`);
        })
        .catch((err) => {
          if (!alive.current) return;
          push(
            'error',
            err instanceof ApiRequestError ? err.message : 'Failed to switch failure mode',
          );
        })
        .finally(() => {
          if (alive.current) setPending(null);
        });
    },
    [push],
  );

  const currentMode: FailureMode = pending ?? state?.mode ?? 'healthy';
  const meta = metaFor(currentMode);
  const trafficDisabled = loading && !state ? true : !!error && !state;
  const sha = state?.deployed_sha ?? null;
  const recorded = meta.failing && !!sha;
  const targetLabel = TARGET_LABEL[meta.target] ?? meta.target;
  const retry = (): void => setNonce((n) => n + 1);

  // Warning banner (§6.4) — shared by both layouts.
  const banner = (
    <div
      className="flex items-start gap-2.5 rounded-lg p-3 text-sm text-ink-2"
      style={{ backgroundColor: tint('warn', 12) }}
      role="note"
    >
      <span className="mt-0.5 shrink-0 text-warn">
        <Icon icon={AlertTriangle} size={16} />
      </span>
      <span>Demo controls — affects the victim app only.</span>
    </div>
  );

  const trafficGenerator = (
    <TrafficGenerator
      target={meta.target}
      targetLabel={targetLabel}
      disabled={trafficDisabled}
      onError={(msg) => push('error', msg)}
      onStats={setTraffic}
    />
  );

  if (variant === 'page') {
    return (
      <div className="flex flex-col gap-8">
        {banner}

        {/* Current-state KPI readout. */}
        <section className="flex flex-col gap-3">
          <SectionHeader title="Current state" icon={Activity} />
          {error && !state ? (
            <Card
              interactive={false}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <span className="text-sm text-ink-2">{error}</span>
              <Button variant="secondary" onClick={retry} className="h-8">
                Retry
              </Button>
            </Card>
          ) : loading && !state ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-border bg-surface p-4 shadow-elev-1">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-3 h-7 w-24" />
                  <Skeleton className="mt-2 h-3 w-16" />
                </div>
              ))}
            </div>
          ) : (
            <StaggerGroup className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StaggerItem className="h-full">
                <StatTile
                  label="Failure mode"
                  icon={meta.icon}
                  accent={v(meta.token)}
                  value={<StatusPill token={meta.token} label={meta.label} pulse={meta.failing} />}
                  caption={meta.sub}
                />
              </StaggerItem>
              <StaggerItem className="h-full">
                <StatTile
                  label="Deployed SHA"
                  icon={GitCommit}
                  value={
                    sha ? (
                      <span className="font-mono text-h1 tabular text-ink" title={sha}>
                        {sha.slice(0, 7)}
                      </span>
                    ) : (
                      <span className="text-h1 text-ink-muted-text">—</span>
                    )
                  }
                  caption={
                    recorded ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-ok">
                          <Icon icon={CheckCircle} size={12} />
                        </span>
                        Deploy recorded
                      </span>
                    ) : sha ? (
                      'Current build'
                    ) : (
                      'No deploy yet'
                    )
                  }
                />
              </StaggerItem>
              <StaggerItem className="h-full">
                <StatTile
                  label="Traffic sent"
                  icon={Radio}
                  accent={traffic.running ? v('ok') : v('accent')}
                  value={traffic.sent}
                  format={(n) => Math.round(n).toLocaleString()}
                  caption={traffic.running ? `Sending ${traffic.rate}/min` : 'Idle this session'}
                />
              </StaggerItem>
            </StaggerGroup>
          )}
        </section>

        {/* Failure mode selector. */}
        <section className="flex flex-col gap-3">
          <SectionHeader
            title="Failure mode"
            icon={SlidersHorizontal}
            right={<span className="text-sm text-ink-muted-text">Flips the victim app</span>}
          />
          <FailureModeSwitch value={currentMode} pending={pending} onSelect={handleSelect} />
        </section>

        {/* Traffic generator control card. */}
        <section className="flex flex-col gap-3">
          <SectionHeader
            title="Traffic generator"
            icon={Radio}
            right={<Chip title="Victim endpoint this burst drives">{targetLabel}</Chip>}
          />
          <Card className="relative overflow-hidden">
            {meta.failing ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
                style={{ backgroundColor: v(meta.token) }}
              />
            ) : null}
            <p className="mb-3 text-sm text-ink-2">{TRAFFIC_BLURB}</p>
            {trafficGenerator}
          </Card>
        </section>

        <ToastStack toasts={toasts} />
      </div>
    );
  }

  // Compact layout (dashboard floating launcher, 340px).
  return (
    <div className="flex flex-col gap-4">
      {banner}

      <section className="flex flex-col gap-2">
        <h2 className="text-label uppercase text-ink-muted-text">Failure mode</h2>
        <FailureModeSwitch value={currentMode} pending={pending} onSelect={handleSelect} />
      </section>

      <CurrentStateReadout
        state={state}
        pending={pending}
        loading={loading}
        error={error}
        onRetry={retry}
      />

      <section
        className="flex flex-col gap-2 rounded-lg border border-border p-3"
        style={{ borderColor: currentMode !== 'healthy' ? tint(meta.token, 40) : undefined }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: v(meta.token) }} />
          <h2 className="text-h3 font-semibold text-ink">Traffic generator</h2>
        </div>
        <p className="text-sm text-ink-2">{TRAFFIC_BLURB}</p>
        {trafficGenerator}
      </section>

      <ToastStack toasts={toasts} />
    </div>
  );
}
