import type { Severity } from '../../lib/types';

/**
 * THE single source of severity colors for the mini-app. Other components
 * import `severityColor` for accents instead of redeclaring hex values.
 */
const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
  passed: '#22c55e',
};

export function severityColor(severity: Severity): string {
  return SEVERITY_COLORS[severity];
}

interface ReviewBadgeProps {
  severity: Severity;
  className?: string;
}

export function ReviewBadge({ severity, className }: ReviewBadgeProps) {
  const color = SEVERITY_COLORS[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] ${className ?? ''}`}
      style={{
        color,
        borderColor: `${color}44`,
        backgroundColor: `${color}1a`,
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {severity}
    </span>
  );
}
