import { Link } from 'react-router-dom';

/**
 * ACT 09 — FINALE. Everything collapses to calm. A long quiet stretch with
 * nothing but the small canvas diamond (0–0.25), then the statement fades in
 * slowly, then the two CTAs. Restraint is the ending. All timing derives
 * from --p via inline clamp() — and every element persists at --p = 1
 * (this is the last, pinned screen).
 */

/** slow fade: 0 at --p=.25 → 1 at --p=.6 (spec: "fading in slowly") */
const SLOW = 'clamp(0, (var(--p, 0) - 0.25) / 0.35, 1)';

export function ActFinale() {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center px-6 text-center">
      {/* keeps the headline below the resting diamond (canvas: x .5, y .44) */}
      <div aria-hidden className="h-[22vh]" />

      <h2
        className="ns-display text-4xl text-white sm:text-6xl"
        style={{
          opacity: SLOW,
          transform: `translateY(calc(18px * (1 - ${SLOW})))`,
        }}
      >
        Sleep. We’ll watch.
      </h2>

      <div
        className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
        style={{
          /* scale-gates the links' hit area to zero during the quiet stretch */
          opacity: 'clamp(0, (var(--p, 0) - 0.45) * 6, 1)',
          transform: 'scale(clamp(0, (var(--p, 0) - 0.44) * 12, 1))',
        }}
      >
        <Link
          to="/dashboard"
          className="cursor-target rounded-sm bg-[#F16524] px-7 py-3.5 font-mono text-sm font-bold uppercase tracking-widest text-black transition-transform hover:scale-[1.03]"
        >
          [ Open Dashboard ]
        </Link>
        <Link
          to="/code-review"
          className="cursor-target rounded-sm border border-white/20 px-7 py-3.5 font-mono text-sm uppercase tracking-widest text-white/75 transition-colors hover:text-white"
        >
          Meet Code Review Buddy →
        </Link>
      </div>

      <p
        className="ns-mono absolute inset-x-0 bottom-7 text-[10px] uppercase tracking-[0.35em] text-white/25"
        style={{ opacity: 'clamp(0, (var(--p, 0) - 0.6) * 4, 1)' }}
      >
        OnCall AI · the night shift is covered
      </p>
    </div>
  );
}
