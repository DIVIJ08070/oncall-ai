import type { ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  className?: string;
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-primary text-black font-bold uppercase tracking-[0.1em] hover:scale-[1.03] active:scale-[0.98] hover:bg-primary-hover',
  secondary:
    'border border-border-strong bg-surface-2 text-ink hover:bg-surface-3',
  ghost: 'text-ink-muted-text hover:text-ink',
};

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
  className,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-sm px-5 py-2.5 font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
