import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './Icon';
import { AnimatedNumber } from '../motion/primitives';

/**
 * KPI stat tile for the console redesign. A compact card with an icon, a label,
 * a big spring-animated value, and an optional delta/status caption. Reads off
 * the shared theme tokens (orange accent, near-black surface) and inherits the
 * `.spot-card` cursor glow from `Card`-style surfaces.
 *
 * `value` may be a number (count-up animated via AnimatedNumber + `format`) or
 * pre-formatted content (string/node) rendered as-is.
 */
export function StatTile({
  label,
  value,
  format = (n) => n.toLocaleString('en-US'),
  icon,
  accent = 'var(--accent)',
  caption,
  className = '',
}: {
  label: string;
  value: number | string | ReactNode;
  format?: (n: number) => string;
  icon?: LucideIcon;
  accent?: string;
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`spot-card group relative overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-elev-1 ${className}`}
    >
      {/* faint accent wash in the corner */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-40"
        style={{ backgroundColor: accent }}
      />
      <div className="flex items-center justify-between">
        <span className="text-label uppercase tracking-wide text-ink-muted-text">{label}</span>
        {icon && (
          <span style={{ color: accent }}>
            <Icon icon={icon} size={16} />
          </span>
        )}
      </div>
      <div className="mt-2 text-hero font-semibold leading-none tabular text-ink">
        {typeof value === 'number' ? (
          <AnimatedNumber value={value} format={format} />
        ) : (
          value
        )}
      </div>
      {caption && <div className="mt-1.5 text-sm text-ink-2">{caption}</div>}
    </div>
  );
}

/** Section header used to break console pages into labelled bands. */
export function SectionHeader({
  title,
  icon,
  right,
  className = '',
}: {
  title: string;
  icon?: LucideIcon;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-end justify-between gap-3 ${className}`}>
      <div className="flex items-center gap-2">
        {icon && (
          <span className="text-accent">
            <Icon icon={icon} size={18} />
          </span>
        )}
        <h2 className="text-h2 font-semibold text-ink">{title}</h2>
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}
