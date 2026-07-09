import { CheckCircle } from 'lucide-react';
import type { FailureMode } from '@oncall/shared';
import { StatusPill, Chip } from '../primitives/Badge';
import { Icon } from '../primitives/Icon';
import { Skeleton } from '../primitives/Skeleton';
import { Button } from '../primitives/Button';
import type { DemoState } from './demoApi';
import { metaFor } from './failureModes';

/**
 * Current-state readout (DESIGN_SPEC §6.4) — the victim's live `mode` + `deployed_sha`
 * (short, mono) from `GET /demo/state`, plus a "Deploy recorded" chip when a failing
 * mode has marked a bad SHA current. Optimistically reflects an in-flight flip.
 */
export function CurrentStateReadout({
  state,
  pending,
  loading,
  error,
  onRetry,
}: {
  state: DemoState | null;
  pending: FailureMode | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading && !state) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
        <Skeleton className="h-6 w-24" rounded="rounded-pill" />
        <Skeleton className="h-4 w-28" />
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 p-3">
        <span className="text-sm text-ink-2">{error}</span>
        <Button variant="secondary" onClick={onRetry} className="h-8">
          Retry
        </Button>
      </div>
    );
  }

  const mode: FailureMode = pending ?? state?.mode ?? 'healthy';
  const meta = metaFor(mode);
  const sha = state?.deployed_sha ?? null;
  const recorded = meta.failing && !!sha;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-label uppercase text-ink-muted-text">Mode</span>
        <StatusPill token={meta.token} label={meta.label} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-label uppercase text-ink-muted-text">Deployed SHA</span>
        <code className="font-mono text-mono-sm text-ink" title={sha ?? undefined}>
          {sha ? sha.slice(0, 7) : '—'}
        </code>
      </div>
      {recorded ? (
        <Chip className="gap-1" title="A deploy row is marked current for this SHA">
          <span className="text-ok">
            <Icon icon={CheckCircle} size={12} />
          </span>
          Deploy recorded
        </Chip>
      ) : null}
    </div>
  );
}
