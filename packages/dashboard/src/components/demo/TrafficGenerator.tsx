import { useEffect, useRef, useState } from 'react';
import { Play, Square, Radio } from 'lucide-react';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Chip } from '../primitives/Badge';
import { AnimatedNumber, Press } from '../motion/primitives';
import { sendTraffic } from './demoApi';

/**
 * TrafficGenerator (DESIGN_SPEC §6.4) — start/stop toggle, rate slider
 * (10–120 req/min, default 40), the resolved victim target, and a live
 * "sending N req/min" counter. Each tick fires a server-side burst at the victim
 * (`POST /demo/traffic`) so metrics/logs populate and the 15s detector fires while a
 * failing mode is active (SPEC §12, §10.3).
 */

const TICK_MS = 1500;
const MIN_RATE = 10;
const MAX_RATE = 120;
const DEFAULT_RATE = 40;

export interface TrafficStats {
  running: boolean;
  rate: number;
  sent: number;
}

export function TrafficGenerator({
  target,
  targetLabel,
  disabled = false,
  onError,
  onStats,
}: {
  /** Traffic target key for `POST /demo/traffic` (from the active mode). */
  target: string;
  /** Human-readable endpoint the burst hits (e.g. "/api/checkout"). */
  targetLabel: string;
  disabled?: boolean;
  onError?: (message: string) => void;
  /** Optional live-stats sink (running/rate/sent) so a parent can surface a KPI. */
  onStats?: (stats: TrafficStats) => void;
}) {
  const [running, setRunning] = useState(false);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [sent, setSent] = useState(0);

  // Latest values without re-subscribing the interval each render.
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const targetRef = useRef(target);
  targetRef.current = target;
  const carry = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;

  // Report live stats upward (KPI readout) — additive, never gates the loop.
  useEffect(() => {
    onStatsRef.current?.({ running, rate, sent });
  }, [running, rate, sent]);

  useEffect(() => {
    if (!running) {
      carry.current = 0;
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const fire = async (): Promise<void> => {
      // Accumulate fractional requests so the burst rate averages exactly `rate`.
      carry.current += (rateRef.current / 60) * (TICK_MS / 1000);
      const count = Math.floor(carry.current);
      if (count < 1) return;
      carry.current -= count;
      try {
        const res = await sendTraffic(
          { count, target: targetRef.current },
          controller.signal,
        );
        if (!cancelled) setSent((n) => n + res.sent);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        onErrorRef.current?.(
          err instanceof Error ? err.message : 'Traffic request failed',
        );
      }
    };

    void fire();
    const id = window.setInterval(() => void fire(), TICK_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
  }, [running]);

  // Stop generating (and reset carry) if the panel becomes disabled.
  useEffect(() => {
    if (disabled && running) setRunning(false);
  }, [disabled, running]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {running ? (
            <span className="flex items-center gap-2 rounded-pill bg-surface-3 py-1 pl-2 pr-3 text-sm font-medium text-ink">
              <span className="relative flex h-2 w-2 items-center justify-center text-ok">
                <span className="absolute inline-flex h-full w-full animate-pulse-live rounded-full bg-ok opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok" />
              </span>
              Sending {rate} req/min
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-pill bg-surface-3 py-1 pl-2 pr-3 text-sm text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ink-muted" />
              Idle
            </span>
          )}
          <Chip title="Victim endpoint this burst drives">{targetLabel}</Chip>
        </div>
        <Press>
          <Button
            variant={running ? 'danger' : 'primary'}
            disabled={disabled}
            onClick={() => setRunning((r) => !r)}
            leadingIcon={<Icon icon={running ? Square : Play} size={16} />}
          >
            {running ? 'Stop traffic' : 'Start traffic'}
          </Button>
        </Press>
      </div>

      <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
        <label htmlFor="traffic-rate" className="text-label uppercase text-ink-muted-text">
          Rate
        </label>
        <input
          id="traffic-rate"
          type="range"
          min={MIN_RATE}
          max={MAX_RATE}
          step={10}
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer accent-accent"
          aria-valuetext={`${rate} requests per minute`}
        />
        <span className="w-20 text-right font-mono text-mono-sm tabular text-ink">
          {rate}/min
        </span>
      </div>

      <p className="flex items-center gap-1.5 text-sm text-ink-muted-text">
        <span className="text-accent">
          <Icon icon={Radio} size={13} />
        </span>
        <AnimatedNumber
          value={sent}
          format={(n) => Math.round(n).toLocaleString()}
          className="tabular font-medium text-ink-2"
        />
        requests sent this session.
      </p>
    </div>
  );
}
