/** ACT 01 — HERO. 02:47 AM. You enter a quiet machine; then it detects something. */
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

const seg = (inP: number, outP: number): CSSProperties =>
  ({ '--in': inP, '--out': outP }) as CSSProperties;

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
      {/* the quiet machine — dim telemetry at the edges, gone by ~0.34 */}
      {TELEMETRY.map((t) => (
        <p
          key={t.text}
          className={`ns-seg ns-mono absolute text-[11px] text-white/30 ${t.pos}`}
          style={seg(-0.125, 0.34)}
        >
          {t.text}
        </p>
      ))}

      {/* center stack */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <p
          className="ns-mono text-xs font-medium tracking-[0.42em] text-[#F16524] sm:text-sm"
          aria-label={KICKER}
        >
          {KICKER.split('').map((c, i) => (
            <span
              key={i}
              aria-hidden
              className="ns-char"
              style={{ '--ci': 0.16 + i * 0.012 } as CSSProperties}
            >
              {c === ' ' ? ' ' : c}
            </span>
          ))}
        </p>

        <h1
          className="ns-seg ns-display mt-7 text-white"
          style={{ ...seg(0.34, 1.04), fontSize: 'clamp(3.5rem, 14vw, 16rem)' }}
        >
          Incidents
          <br />
          happen.
        </h1>

        <div className="ns-seg mt-9" style={seg(0.57, 1.04)}>
          <p className="ns-mono text-xs font-bold uppercase tracking-[0.34em] text-white/80">
            OnCall AI
          </p>
          <p className="mt-2 text-base text-white/50 sm:text-lg">Your AI incident responder.</p>
        </div>

        <div className="ns-seg mt-9 flex flex-col items-center gap-3 sm:flex-row" style={seg(0.66, 1.04)}>
          <Link
            to="/dashboard"
            className="cursor-target rounded-sm bg-[#F16524] px-6 py-3 font-mono text-xs font-bold uppercase tracking-[0.22em] text-black transition-transform hover:scale-[1.03]"
          >
            Open Dashboard
          </Link>
          <Link
            to="/code-review"
            className="cursor-target rounded-sm border border-white/20 px-6 py-3 font-mono text-xs uppercase tracking-[0.22em] text-white/70 transition-colors hover:text-white"
          >
            Meet Code Review Buddy
          </Link>
        </div>
      </div>

      {/* scroll cue — tiny line + chevron, dim */}
      <div className="ns-seg absolute inset-x-0 bottom-9 flex justify-center" style={seg(0.72, 1.04)}>
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
          opacity: 'calc((0.85 - var(--p, 0)) * 1.7)',
        }}
      />
    </div>
  );
}
