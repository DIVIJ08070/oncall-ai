import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Atmosphere engine — the "piece of art" layer (inspired by igloo.inc). A dark,
 * cinematic HUD skin: film grain, drifting aurora depth, hairline corner
 * brackets, and mono micro-labels. Orange (#FF8233 / var(--accent)) is the one
 * laser accent. Everything here is DECORATIVE and pointer-events-none, sits
 * behind content, and collapses to a calm static state under reduced motion.
 */

const GRAIN_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.85'/></svg>",
  );

/** Fixed film-grain overlay across the whole viewport. */
export function Grain({ opacity = 0.16 }: { opacity?: number }) {
  return (
    <div
      aria-hidden
      className="atm-grain pointer-events-none fixed inset-0 z-[80] mix-blend-soft-light"
      style={{
        backgroundImage: `url("${GRAIN_SVG}")`,
        backgroundSize: '180px 180px',
        opacity,
      }}
    />
  );
}

/** Retired under the phosphor terminal theme (no gradient blobs). The export
 * remains so existing call sites keep compiling; it renders nothing. */
export function Aurora(_props: { className?: string; colors?: string[] }) {
  return null;
}

/** Hairline corner brackets that frame a panel like a viewfinder. */
export function HudCorners({
  size = 14,
  inset = 0,
  color = 'var(--accent)',
  className = '',
}: {
  size?: number;
  inset?: number;
  color?: string;
  className?: string;
}) {
  const base: CSSProperties = { position: 'absolute', width: size, height: size, borderColor: color };
  const corners: CSSProperties[] = [
    { top: inset, left: inset, borderTop: '1px solid', borderLeft: '1px solid' },
    { top: inset, right: inset, borderTop: '1px solid', borderRight: '1px solid' },
    { bottom: inset, left: inset, borderBottom: '1px solid', borderLeft: '1px solid' },
    { bottom: inset, right: inset, borderBottom: '1px solid', borderRight: '1px solid' },
  ];
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 ${className}`}>
      {corners.map((c, i) => (
        <span key={i} style={{ ...base, ...c }} />
      ))}
    </div>
  );
}

/** Mono micro-label — the HUD's technical typography. e.g. "SYS · TELEMETRY". */
export function MonoTag({
  children,
  className = '',
  dot = true,
  style,
}: {
  children: ReactNode;
  className?: string;
  dot?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted-text ${className}`}
      style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", ...style }}
    >
      {dot && <span className="h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />}
      {children}
    </span>
  );
}

/** CRT-style scanlines — fixed, very fine, adds the cinematic HUD texture. */
export function Scanlines({ opacity = 0.5 }: { opacity?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[70]"
      style={{
        opacity,
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(255,176,0,0.05) 0px, rgba(255,176,0,0.05) 1px, transparent 1px, transparent 3px)',
      }}
    />
  );
}

/** A slow horizontal scan-sweep bar that travels down the viewport. */
export function ScanSweep() {
  return (
    <div
      aria-hidden
      className="atm-sweep pointer-events-none fixed inset-x-0 top-0 z-[71] h-[36vh]"
      style={{
        background:
          'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--accent) 8%, transparent) 60%, transparent)',
      }}
    />
  );
}

/**
 * Full-bleed background stack for a page/section: grain + aurora + a faint HUD
 * grid. Drop it as the first child of a `relative` container.
 */
export function AtmosphereBackdrop({ grid = true }: { grid?: boolean }) {
  const gridStyle = useMemo<CSSProperties>(
    () => ({
      backgroundImage:
        'linear-gradient(rgba(255,176,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,176,0,0.05) 1px, transparent 1px)',
      backgroundSize: '52px 52px',
      maskImage: 'radial-gradient(120% 80% at 50% 0%, black 30%, transparent 85%)',
      WebkitMaskImage: 'radial-gradient(120% 80% at 50% 0%, black 30%, transparent 85%)',
    }),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <Aurora />
      {grid && <div className="absolute inset-0" style={gridStyle} />}
    </div>
  );
}
