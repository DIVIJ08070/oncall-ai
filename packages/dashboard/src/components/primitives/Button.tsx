import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Button (DESIGN_SPEC §7): height 36 (default) / 44 touch, radius 6, `text-body-md`.
 * Variants: primary/secondary/ghost/danger. Focus ring is the global `:focus-visible`.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-white hover:bg-primary-hover active:brightness-95 disabled:bg-surface-3 disabled:text-ink-muted',
  secondary:
    'bg-transparent border border-border-strong text-ink hover:bg-surface-3 disabled:text-ink-muted',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-3 hover:text-ink',
  danger: 'bg-critical text-white hover:brightness-110',
};

export function Button({
  variant = 'secondary',
  leadingIcon,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  leadingIcon?: ReactNode;
}) {
  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-body-md font-medium transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-90 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {leadingIcon}
      {children}
    </button>
  );
}

/** Square ghost icon button — requires an `aria-label` (DESIGN_SPEC §7). */
export function IconButton({
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label': string }) {
  return (
    <button
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors duration-fast hover:bg-surface-3 hover:text-ink disabled:cursor-not-allowed disabled:text-ink-muted ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
