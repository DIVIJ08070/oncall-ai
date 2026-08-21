/** ACT 01 — HERO. 02:47 AM. A quiet machine; the diamond powers on dead center.
 *
 * Composition (the canvas owns the middle): the diamond powers on at screen
 * center from --p ~0.4 and the network world fades in beneath, so every DOM
 * element clears the central band. The statement splits around it —
 * INCIDENTS upper-left, HAPPEN. lower-right. Brand + CTAs live in the bottom
 * third (left, above the fixed act indicator); scroll cue stays bottom-center.
 *
 * Timing: the sticky viewport releases at --p = 1 − 100/240 ≈ 0.583; after
 * that the act rides up while BREAK slides in (the fixed canvas persists).
 * Every entrance therefore completes by ~0.55, and --out windows sit past 1
 * so elements exit by riding off, never by dimming mid-slide.
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

const seg = (inP: number, outP: number, extra?: CSSProperties): CSSProperties =>
  ({ '--in': inP, '--out': outP, ...extra }) as CSSProperties;

const KICKER = 'INCIDENT DETECTED';

/** Edge telemetry: pinned to viewport corners/sides, visible from --p 0 (negative --in). */
const TELEMETRY: Array<{ pos: string; text: string }> = [
  { pos: 'left-5 top-16 md:left-8', text: 'cluster: production' },
  { pos: 'right-5 top-16 text-right md:right-8', text: '02:47:13 AM' },
  { pos: 'left-5 top-[48%] md:left-8', text: 'services: 47' },
  { pos: 'right-5 top-[48%] text-right md:right-8', text: 'latency: 82ms' },
  { pos: 'left-5 bottom-28 md:left-8', text: 'status: nominal' },
  { pos: 'right-5 bottom-28 text-right md:right-8', text: 'errors: 0.02%' },
];

export function ActHero() {
  const rootRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);

  // Spotlight follows the cursor via direct style writes (mousemove is allowed;
  // only scroll listeners are banned). No React state — zero re-renders.
  useEffect(() => {
    const root = rootRef.current;
    const spot = spotRef.current;
    if (!root || !spot) return;
    const onMove = (e: MouseEvent): void => {
      spot.style.setProperty('--mx', `${e.clientX}px`);
      spot.style.setProperty('--my', `${e.clientY}px`);
    };
    root.addEventListener('mousemove', onMove);
    return () => root.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div ref={rootRef} className="relative h-full w-full">
      {/* the quiet machine — dim telemetry at the edges, gone as the statement lands */}
      {TELEMETRY.map((t) => (
        <p
          key={t.text}
          className={`ns-seg ns-mono absolute text-[11px] text-white/30 ${t.pos}`}
          style={seg(-0.125, 0.3)}
        >
          {t.text}
        </p>
      ))}

      {/* kicker — chars materialize from --p .1, upper-left above the statement */}
      <div className="ns-seg absolute left-[4.5vw] top-[8vh]" style={seg(-0.2, 1.2)}>
        <p
          className="ns-mono text-xs font-medium tracking-[0.42em] text-[#F16524] sm:text-sm"
          aria-label={KICKER}
        >
          {KICKER.split('').map((c, i) => (
            <span
              key={i}
              aria-hidden
              className="ns-char"
              style={{ '--ci': 0.1 + i * 0.01 } as CSSProperties}
            >
              {c === ' ' ? ' ' : c}
            </span>
          ))}
        </p>
      </div>

      {/* the statement — colossal, split diagonally around the center diamond:
          line 1 crosses the top band, line 2 grazes the lower tip. Both land
          while pinned (0.3/0.36) and ride off with the slide-out. */}
      <h1
        className="ns-display pointer-events-none absolute inset-0 text-white"
        style={{ fontSize: 'clamp(3.5rem, 14vw, 15rem)' }}
      >
        <span
          className="ns-seg absolute left-[4vw] top-[12vh] block"
          style={seg(0.3, 1.2, { '--rise': '44px' } as CSSProperties)}
        >
          Incidents
        </span>
        <span
          className="ns-seg absolute right-[6vw] top-[54vh] block text-right"
          style={seg(0.36, 1.2, { '--rise': '44px' } as CSSProperties)}
        >
          happen.
        </span>
      </h1>

      {/* bottom third — brand + CTAs, left-composed, raised above the act indicator */}
      <div className="absolute bottom-[14vh] left-[4vw] flex flex-col items-start text-left">
        <div className="ns-seg" style={seg(0.4, 1.2)}>
          <p className="ns-mono text-xs font-bold uppercase tracking-[0.34em] text-white/80">
            OnCall AI
          </p>
          <p className="mt-1.5 text-base text-white/50 sm:text-lg">Your AI incident responder.</p>
        </div>
        <div
          className="ns-seg mt-6 flex flex-col items-start gap-3 sm:flex-row"
          style={seg(0.46, 1.2)}
        >
          <Link
            to="/dashboard"
            className="cursor-target bg-[#F16524] px-6 py-3 font-mono text-xs font-bold uppercase tracking-[0.22em] text-black transition-transform hover:scale-[1.03]"
          >
            Open Dashboard
          </Link>
          <Link
            to="/code-review"
            className="cursor-target border border-white/20 px-6 py-3 font-mono text-xs uppercase tracking-[0.22em] text-white/70 transition-colors hover:text-white"
          >
            Meet Code Review Buddy
          </Link>
        </div>
      </div>

      {/* scroll cue — tiny line + chevron, dim, bottom-center */}
      <div className="ns-seg absolute inset-x-0 bottom-9 flex justify-center" style={seg(0.52, 1.2)}>
        <div className="flex flex-col items-center gap-2 text-white/35">
          <span className="ns-mono text-[10px] uppercase tracking-[0.34em]">scroll</span>
          <span className="h-7 w-px bg-white/25" />
          <svg className="ns-pulse" width={12} height={7} viewBox="0 0 12 7" fill="none" aria-hidden>
            <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth={1.4} />
          </svg>
        </div>
      </div>

      {/* spotlight: the darkness parts around the cursor; fades out as --p grows */}
      <div
        ref={spotRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle 24rem at var(--mx, 50%) var(--my, 42%), rgba(0,0,0,0) 0%, rgba(0,0,0,0.3) 55%, rgba(0,0,0,0.62) 100%)',
          opacity: 'calc((0.55 - var(--p, 0)) * 2.2)',
        }}
      />
    </div>
  );
}
