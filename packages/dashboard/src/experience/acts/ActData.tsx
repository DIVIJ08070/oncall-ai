/**
 * ACT 05 — THE DATA. A wall of raw severity words is what the canvas particles
 * "are": the wall bursts (fades/scales out) exactly as the canvas explosion
 * starts (--p 0.12–0.18), annotations frame the reformed error-rate curve
 * (0.45–0.78), a green tick lands as the spike recovers (0.85+), and the act
 * closes on the statement. All choreography derives from --p — no listeners.
 *
 * Canvas contract (WorldCanvas, act 4): dot grid x .2–.78 / y .30–.575,
 * explode .12–.40, reform into curve .45–.75 (baseline y≈.62, spike top y≈.40
 * at x≈.536), recovery .8–1. Diamond parked at (.5, .3).
 */

const SEV_STYLE: Record<string, string> = {
  ERROR: 'text-white/40',
  WARN: 'text-white/25',
  INFO: 'text-white/[0.15]',
  TRACE: 'text-white/10',
};

function seeded(n: number): () => number {
  let s = n >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const rand = seeded(31703);
const WALL: string[][] = Array.from({ length: 7 }, () =>
  Array.from({ length: 8 }, () => {
    const r = rand();
    return r < 0.55 ? 'ERROR' : r < 0.78 ? 'WARN' : r < 0.92 ? 'INFO' : 'TRACE';
  }),
);

export function ActData() {
  return (
    <div className="relative h-full w-full">
      {/* 0.00–0.18 — the wall of severity words (becomes the particles).
          Fully visible until the canvas explosion starts at .12, gone by .18,
          scaling outward as it bursts. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-[26%] flex flex-col items-center gap-[2.4vh]"
        style={
          {
            opacity: 'clamp(0, (0.18 - var(--p, 0)) * 16.6, 1)',
            transform: 'scale(calc(1 + clamp(0, (var(--p, 0) - 0.12) * 4, 0.24)))',
          } as React.CSSProperties
        }
      >
        <p className="ns-mono mb-[1.2vh] text-[10px] tracking-[0.4em] text-white/30">
          LOG STREAM · api-gateway · 03:16:12
        </p>
        {WALL.map((row, ri) => (
          <div
            key={ri}
            className="ns-mono flex gap-[2.2vw] text-xs tracking-[0.25em] sm:text-sm"
          >
            {row.map((w, wi) => (
              <span key={wi} className={SEV_STYLE[w]}>
                {w}
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* 0.45–0.78 — annotations around the canvas curve */}
      <div
        className="ns-seg absolute left-[6%] top-[46%]"
        style={{ '--in': 0.46, '--out': 0.97, '--rise': '12px' } as React.CSSProperties}
      >
        <span className="ns-mono inline-block -rotate-90 text-[10px] tracking-[0.4em] text-white/35">
          ERROR RATE
        </span>
      </div>

      <div
        className="ns-seg absolute left-[14%] right-[14%] top-[65%] h-px bg-white/10"
        style={{ '--in': 0.48, '--out': 0.97, '--rise': '10px' } as React.CSSProperties}
      />
      <div
        className="ns-seg ns-mono absolute left-[14%] right-[14%] top-[67%] flex justify-between text-[10px] text-white/25"
        style={{ '--in': 0.5, '--out': 0.97, '--rise': '10px' } as React.CSSProperties}
      >
        <span>03:00</span>
        <span>03:10</span>
        <span>03:20</span>
        <span>03:30</span>
        <span>03:40</span>
      </div>

      {/* the spike callout — right of the peak, clear of the diamond at (.5,.3) */}
      <div
        className="ns-seg absolute left-[59%] top-[37.5%] flex items-center gap-2"
        style={{ '--in': 0.58, '--out': 0.92, '--rise': '14px' } as React.CSSProperties}
      >
        <span className="h-px w-[4.5vw] bg-[#F16524]/70" />
        <span className="ns-mono text-[10px] font-bold tracking-[0.3em] text-[#FF8233]">
          SPIKE 03:17
        </span>
      </div>

      {/* 0.85+ — recovery tick, lands as the canvas spike settles */}
      <div
        className="ns-mono absolute left-[56%] top-[55%] text-[11px] tracking-[0.3em] text-emerald-400/90"
        style={
          {
            opacity: 'clamp(0, (var(--p, 0) - 0.85) * 14, 1)',
            transform: 'translateY(calc(clamp(0, (0.92 - var(--p, 0)) * 14, 1) * 10px))',
          } as React.CSSProperties
        }
      >
        ✓ RECOVERED
      </div>

      {/* 0.78–1.00 — closing statement */}
      <div className="absolute inset-x-0 bottom-[9%] flex flex-col items-center px-6 text-center">
        <h2
          className="ns-seg ns-display text-4xl text-white sm:text-6xl"
          style={{ '--in': 0.78, '--out': 1.15 } as React.CSSProperties}
        >
          It doesn't just detect the fire.
        </h2>
        <p
          className="ns-seg mt-5 text-base text-white/55 sm:text-lg"
          style={{ '--in': 0.85, '--out': 1.15, '--rise': '18px' } as React.CSSProperties}
        >
          It stays until the smoke clears.
        </p>
      </div>
    </div>
  );
}
