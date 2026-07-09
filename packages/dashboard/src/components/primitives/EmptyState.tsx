import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * EmptyState (DESIGN_SPEC §7): 24px icon (`--ink-muted`), title, subtitle, optional
 * CTA. Centered, padding 32. Used for every "empty" surface (§10).
 */
export function EmptyState({
  icon,
  iconToken = 'ink-muted',
  title,
  subtitle,
  action,
  className = '',
}: {
  icon: LucideIcon;
  iconToken?: string;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 p-8 text-center ${className}`}
    >
      <span style={{ color: `var(--${iconToken})` }}>
        <Icon icon={icon} size={24} />
      </span>
      <p className="text-body-md font-medium text-ink">{title}</p>
      {subtitle ? <p className="max-w-xs text-sm text-ink-2">{subtitle}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
