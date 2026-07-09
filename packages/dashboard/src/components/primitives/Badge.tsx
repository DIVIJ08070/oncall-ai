import type { ReactNode } from 'react';
import { tint, v } from '../../lib/tokens';

/**
 * Status pill (DESIGN_SPEC §7): tinted surface = status color @14%, an 8px dot in
 * the status color, label in `--ink` (never in the status hue — §11). Color is
 * never the only channel: the text label is mandatory.
 */
export function StatusPill({
  token,
  label,
  icon,
  pulse = false,
  className = '',
}: {
  token: string;
  label: string;
  icon?: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-pill px-2.5 text-sm font-medium text-ink ${className}`}
      style={{ backgroundColor: tint(token, 14) }}
    >
      {icon ?? (
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${pulse ? 'animate-pulse-live' : ''}`}
          style={{ backgroundColor: v(token) }}
        />
      )}
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
}

/** Neutral chip — `--surface-3` bg, `--ink-2` text (service, branch, detector). */
export function Chip({
  children,
  className = '',
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 items-center rounded-pill bg-surface-3 px-2 text-sm text-ink-2 ${className}`}
    >
      {children}
    </span>
  );
}
