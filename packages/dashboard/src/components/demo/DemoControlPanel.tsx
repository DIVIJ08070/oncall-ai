import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { FailureMode } from '@oncall/shared';
import { Icon } from '../primitives/Icon';
import { v, tint } from '../../lib/tokens';
import { ApiRequestError } from '../../api/client';
import { FailureModeSwitch } from './FailureModeSwitch';
import { CurrentStateReadout } from './CurrentStateReadout';
import { TrafficGenerator } from './TrafficGenerator';
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

/**
 * DemoControlPanel (DESIGN_SPEC §6.4/§8.8) — the shared body used by both the `/demo`
 * page (640px centered card) and the dashboard floating launcher (340px panel). The
 * wrappers set the width; the body is width-agnostic (the FailureModeSwitch stacks
 * below the `sm` breakpoint, so it reads correctly in a 340px panel). Owns the victim
 * state (`mode` + `deployed_sha`), the in-flight flip, and the toast surface, and
 * threads them into the FailureModeSwitch, current-state readout, and TrafficGenerator.
 */
export function DemoControlPanel() {
  const [state, setState] = useState<DemoState | null>(null);
  const [pending, setPending] = useState<FailureMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
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

  return (
    <div className="flex flex-col gap-4">
      {/* Warning banner (§6.4). */}
      <div
        className="flex items-start gap-2 rounded-lg p-3 text-sm text-ink-2"
        style={{ backgroundColor: tint('warn', 12) }}
        role="note"
      >
        <span className="mt-0.5 shrink-0 text-warn">
          <Icon icon={AlertTriangle} size={16} />
        </span>
        <span>Demo controls — affects the victim app only.</span>
      </div>

      {/* FailureModeSwitch (§8.8). */}
      <section className="flex flex-col gap-2">
        <h2 className="text-label uppercase text-ink-muted-text">Failure mode</h2>
        <FailureModeSwitch value={currentMode} pending={pending} onSelect={handleSelect} />
      </section>

      {/* Current-state readout (§6.4). */}
      <CurrentStateReadout
        state={state}
        pending={pending}
        loading={loading}
        error={error}
        onRetry={() => setNonce((n) => n + 1)}
      />

      {/* TrafficGenerator (§6.4). */}
      <section
        className="flex flex-col gap-2 rounded-lg border border-border p-3"
        style={{ borderColor: currentMode !== 'healthy' ? tint(meta.token, 40) : undefined }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: v(meta.token) }} />
          <h2 className="text-h3 font-semibold text-ink">Traffic generator</h2>
        </div>
        <p className="text-sm text-ink-2">
          Drive requests at the victim so metrics populate and — under a failing mode —
          the detector opens an incident within ~15s.
        </p>
        <TrafficGenerator
          target={meta.target}
          targetLabel={TARGET_LABEL[meta.target] ?? meta.target}
          disabled={trafficDisabled}
          onError={(msg) => push('error', msg)}
        />
      </section>

      <ToastStack toasts={toasts} />
    </div>
  );
}
