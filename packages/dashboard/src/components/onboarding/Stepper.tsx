import { Check } from 'lucide-react';
import { Icon } from '../primitives/Icon';

/**
 * Onboarding Stepper (DESIGN_SPEC §6.1): numbered nodes + connectors. Current node
 * is filled `--accent`; completed is `--ok` with a check; upcoming is `--surface-3`.
 * Horizontal with labels on ≥sm; **compact dots only** on mobile (§6.1/§12).
 * `current` is 1-based.
 */
export function Stepper({
  steps,
  current,
  className = '',
}: {
  steps: string[];
  current: number;
  className?: string;
}) {
  return (
    <nav aria-label="Onboarding progress" className={className}>
      <ol className="flex items-center">
        {steps.map((label, i) => {
          const n = i + 1;
          const state: 'done' | 'current' | 'upcoming' =
            n < current ? 'done' : n === current ? 'current' : 'upcoming';
          const isLast = i === steps.length - 1;

          return (
            <li
              key={label}
              className={`flex items-center ${isLast ? '' : 'flex-1'}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-pill text-sm font-medium ${
                    state === 'done'
                      ? 'bg-ok text-white'
                      : state === 'current'
                        ? 'bg-accent text-white'
                        : 'bg-surface-3 text-ink-muted-text'
                  }`}
                >
                  {state === 'done' ? <Icon icon={Check} size={16} /> : n}
                </span>
                <span
                  className={`hidden whitespace-nowrap text-sm sm:inline ${
                    state === 'upcoming'
                      ? 'text-ink-muted-text'
                      : state === 'current'
                        ? 'font-medium text-ink'
                        : 'text-ink'
                  }`}
                >
                  {label}
                </span>
              </div>
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={`mx-2 h-0.5 flex-1 rounded-pill ${
                    n < current ? 'bg-accent' : 'bg-surface-3'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
