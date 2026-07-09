/**
 * Skeleton (DESIGN_SPEC §7): `--surface-3` block, radius 4, subtle shimmer
 * (disabled under reduced-motion via the global media query). Match the real
 * element's shape/height so first paint doesn't shift.
 */
export function Skeleton({
  className = '',
  rounded = 'rounded-sm',
  style,
}: {
  className?: string;
  rounded?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`animate-shimmer bg-surface-3 ${rounded} ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}
