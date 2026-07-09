/**
 * SegmentedControl (DESIGN_SPEC §7) — track `--surface-2`, 32/40 height; selected
 * segment `--surface` + `--ink`; unselected `--ink-2`. Arrow keys move selection
 * (`role="tablist"` / `aria-selected`). Used for the mobile IncidentDetail
 * `[Investigation · Details · Chat]` switch (§6.3).
 */
export interface Segment<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  ariaLabel,
  className = '',
}: {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const move = (dir: 1 | -1): void => {
    const idx = segments.findIndex((s) => s.value === value);
    const next = (idx + dir + segments.length) % segments.length;
    onChange(segments[next].value);
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5 ${className}`}
    >
      {segments.map((seg) => {
        const active = seg.value === value;
        return (
          <button
            key={seg.value}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(seg.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                move(1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                move(-1);
              }
            }}
            className={`inline-flex h-10 flex-1 items-center justify-center rounded-md px-3 text-body-md font-medium transition-colors duration-fast ${
              active ? 'bg-surface text-ink shadow-elev-1' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
