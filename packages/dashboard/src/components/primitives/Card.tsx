import type { MouseEvent, ReactNode } from 'react';

/**
 * Card primitive (DESIGN_SPEC §7): `--surface` + 1px `--border`, radius 8,
 * `--elev-1`, padding 20 (16 mobile). Header row = title + optional right slot,
 * 12px gap to body.
 *
 * Cards carry the `.spot-card` interaction (see index.css): on hover they lift,
 * warm their border, and reveal a soft radial highlight that tracks the pointer
 * — the console echo of the landing hero's spotlight. Pass `interactive={false}`
 * for surfaces where that would be noise (e.g. a card nested inside a card).
 */
export function Card({
  children,
  className = '',
  as: Tag = 'section',
  padded = true,
  interactive = true,
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
  padded?: boolean;
  interactive?: boolean;
}) {
  // Local pointer position drives this card's highlight, in CSS-var space so the
  // gradient itself stays declarative (no per-frame React state).
  const onMouseMove = (e: MouseEvent<HTMLElement>): void => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--cx', `${e.clientX - r.left}px`);
    el.style.setProperty('--cy', `${e.clientY - r.top}px`);
  };

  return (
    <Tag
      onMouseMove={interactive ? onMouseMove : undefined}
      className={`rounded-lg border border-border bg-surface shadow-elev-1 ${
        interactive ? 'spot-card' : ''
      } ${padded ? 'p-4 md:p-5' : ''} ${className}`}
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
