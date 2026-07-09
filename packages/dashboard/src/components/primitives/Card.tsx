import type { ReactNode } from 'react';

/**
 * Card primitive (DESIGN_SPEC §7): `--surface` + 1px `--border`, radius 8,
 * `--elev-1`, padding 20 (16 mobile). Header row = title + optional right slot,
 * 12px gap to body.
 */
export function Card({
  children,
  className = '',
  as: Tag = 'section',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
  padded?: boolean;
}) {
  return (
    <Tag
      className={`rounded-lg border border-border bg-surface shadow-elev-1 ${
        padded ? 'p-4 md:p-5' : ''
      } ${className}`}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  icon,
  right,
  className = '',
}: {
  title: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <h3 className="truncate text-h3 font-semibold text-ink">{title}</h3>
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}
