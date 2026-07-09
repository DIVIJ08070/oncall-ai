import type { LucideIcon } from 'lucide-react';

/**
 * Line-icon wrapper (DESIGN_SPEC §3): 1.5px stroke, `currentColor`, decorative by
 * default (`aria-hidden`) unless given a `label` (standalone icon → accessible name).
 */
export function Icon({
  icon: I,
  size = 16,
  className,
  label,
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <I
      size={size}
      strokeWidth={1.5}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      focusable={false}
    />
  );
}
