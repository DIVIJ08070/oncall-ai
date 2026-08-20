import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './Icon';
import { AnimatedNumber } from '../motion/primitives';
import { HudCorners, MonoTag } from '../atmosphere';

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
      className={`spot-card group relative overflow-hidden rounded-lg border border-border bg-surface/80 p-4 shadow-elev-1 backdrop-blur-sm ${className}`}
    >
      {/* faint accent wash in the corner */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-40"
        style={{ backgroundColor: accent }}
      />
      {/* HUD viewfinder brackets that brighten on hover */}
      <HudCorners size={10} inset={6} color={accent} className="opacity-40 transition-opacity duration-300 group-hover:opacity-90" />
      <div className="flex items-center justify-between">
        <MonoTag dot={false}>{label}</MonoTag>
        {icon && (
          <span style={{ color: accent }}>
            <Icon icon={icon} size={15} />
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
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="text-accent">
            <Icon icon={icon} size={18} />
          </span>
        )}
        <h2 className="text-h2 font-semibold text-ink">{title}</h2>
        <span aria-hidden className="hidden h-px flex-1 bg-gradient-to-r from-border to-transparent sm:block" style={{ minWidth: 40 }} />
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}
