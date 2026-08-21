import { Link } from 'react-router-dom';

/**
 * ACT 09 — FINALE. Everything collapses to calm. A long stretch of nothing but
 * the small canvas diamond (0–0.30), then two colossal stacked lines land with
 * a beat between them — SLEEP. (0.30) … WE'LL WATCH. (0.50) — then the CTAs.
 * Restraint is the ending. All timing derives from --p via .ns-seg windows and
 * inline clamp() — and every element persists at --p = 1 (last, pinned screen).
 */

const seg = (i: number, o: number, extra?: React.CSSProperties): React.CSSProperties =>
  ({ '--in': i, '--out': o, ...extra } as React.CSSProperties);

export function ActFinale() {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center px-6 text-center">
      {/* keeps the stack below the resting diamond (canvas: x 0, y 0.35, shrinking) */}
      <div aria-hidden className="h-[16vh]" />

      <h2 className="ns-display text-[clamp(3.5rem,10vw,9.5rem)] leading-[0.92] text-[#F5F5F2]">
        <span className="ns-seg block" style={seg(0.3, 1.5, { '--rise': '36px' } as React.CSSProperties)}>
          Sleep.
        </span>
        <span className="ns-seg block" style={seg(0.5, 1.5, { '--rise': '36px' } as React.CSSProperties)}>
          We’ll watch.
        </span>
      </h2>

      <div
        className="mt-12 flex flex-col items-center gap-3 sm:flex-row"
        style={{
          /* scale-gates the links' hit area to zero during the quiet stretch */
          opacity: 'clamp(0, (var(--p, 0) - 0.66) * 8, 1)',
          transform: 'scale(clamp(0, (var(--p, 0) - 0.65) * 10, 1))',
        }}
      >
        <Link
          to="/dashboard"
          className="cursor-target bg-[#F16524] px-7 py-3.5 font-mono text-sm font-bold uppercase tracking-widest text-black transition-transform hover:scale-[1.03]"
        >
          [ Open Dashboard ]
        </Link>
        <Link
          to="/code-review"
          className="cursor-target border border-white/20 px-7 py-3.5 font-mono text-sm uppercase tracking-widest text-white/75 transition-colors hover:text-white"
        >
          Meet Code Review Buddy →
        </Link>
      </div>

      <p
        className="ns-mono absolute inset-x-0 bottom-7 text-[10px] uppercase tracking-[0.35em] text-white/25"
        style={{ opacity: 'clamp(0, (var(--p, 0) - 0.78) * 6, 1)' }}
      >
        OnCall AI · the night shift is covered
      </p>
    </div>
  );
}
