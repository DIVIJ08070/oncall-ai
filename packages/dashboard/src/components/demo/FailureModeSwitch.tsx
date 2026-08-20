import { useRef } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { FailureMode } from '@oncall/shared';
import { Icon } from '../primitives/Icon';
import { Entrance, Press } from '../motion/primitives';
import { v, tint } from '../../lib/tokens';
import { FAILURE_MODE_META } from './failureModes';

/**
 * FailureModeSwitch (DESIGN_SPEC §8.8) — a radiogroup of four mode cards (2×2 grid
 * ≥640, stacked below). Selecting a card flips the victim via
 * `POST /demo/failure-mode` (wired by the parent panel). Selected = 2px accent ring +
 * accent @12% bg; failing modes carry their warning/critical accent to signal "this
 * breaks the app". Arrow keys move selection within the group (§11 keyboard).
 */
export function FailureModeSwitch({
  value,
  pending,
  onSelect,
}: {
  /** Currently-selected mode (optimistic while a flip is in flight). */
  value: FailureMode;
  /** The mode whose flip is in flight, or null. */
  pending: FailureMode | null;
  onSelect: (mode: FailureMode) => void;
}) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number): void => {
    const next = (from + delta + FAILURE_MODE_META.length) % FAILURE_MODE_META.length;
    const meta = FAILURE_MODE_META[next];
    btnRefs.current[next]?.focus();
    onSelect(meta.mode);
  };

  const onKeyDown = (e: React.KeyboardEvent, idx: number): void => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(idx, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(idx, -1);
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Victim failure mode"
      className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2"
    >
      {FAILURE_MODE_META.map((m, idx) => {
        const selected = value === m.mode;
        const isPending = pending === m.mode;
        return (
          <Entrance key={m.mode} delay={idx * 0.05} className="h-full">
            <Press className="h-full">
              <button
                ref={(el) => (btnRefs.current[idx] = el)}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                disabled={pending !== null}
                onClick={() => onSelect(m.mode)}
                onKeyDown={(e) => onKeyDown(e, idx)}
                className={`group flex h-full w-full items-start gap-3 rounded-xl border p-4 text-left transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed ${
                  selected
                    ? 'border-transparent shadow-elev-1'
                    : 'border-border bg-surface hover:border-border-strong hover:bg-surface-3'
                }`}
                style={
                  selected
                    ? {
                        boxShadow: `inset 0 0 0 2px ${v(m.token)}`,
                        backgroundColor: tint(m.token, 12),
                      }
                    : undefined
                }
              >
                <span
                  className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors duration-fast"
                  style={{
                    color: v(m.token),
                    backgroundColor: tint(m.token, selected ? 18 : 12),
                  }}
                >
                  <Icon
                    icon={isPending ? Loader2 : m.icon}
                    size={18}
                    className={isPending ? 'animate-spin' : ''}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="block text-body-md font-medium text-ink">{m.label}</span>
                    {selected && !isPending ? (
                      <span style={{ color: v(m.token) }}>
                        <Icon icon={Check} size={16} />
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-2">
                    {isPending ? 'Switching…' : m.sub}
                  </span>
                </span>
              </button>
            </Press>
          </Entrance>
        );
      })}
    </div>
  );
}
