/**
 * ACT 05 — THE DATA. The DOM carries this act (the 3D world recedes to a
 * distant backdrop; the diamond parks upper-middle and pulses through the
 * spike window): a wall of raw severity words fills the whole frame, then
 * disperses row by row — translate/blur/opacity, each a pure calc() of --p —
 * leaving a beat of empty night before a hairline error-rate graph draws
 * itself mid-lower with floating annotations. No listeners, no rAF.
 *
 * TIMING: the sticky frame stays pinned only while --p ∈ [0, (220-100)/220
 * ≈ 0.545]; later windows ride the scroll-away, so the closing statement
 * anchors to the BOTTOM of the frame — the last region still on screen as
 * the act leaves. Wall fills 0–0.15 · rows disperse 0.15–0.435 · quiet ·
 * graph + annotations 0.45–0.84 · statement 0.78 → end.
 */

type CSS = React.CSSProperties;

const seg = (inAt: number, outAt: number, rise = 28): CSS =>
  ({ '--in': inAt, '--out': outAt, '--rise': `${rise}px` } as CSS);

const SEV_STYLE: Record<string, string> = {
  ERROR: 'text-white/45',
  WARN: 'text-white/25',
  INFO: 'text-white/[0.14]',
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
const WALL: string[][] = Array.from({ length: 9 }, () =>
  Array.from({ length: 8 }, () => {
    const r = rand();
    return r < 0.55 ? 'ERROR' : r < 0.78 ? 'WARN' : r < 0.92 ? 'INFO' : 'TRACE';
  }),
);

/** Per-row dispersal: scattered order (not a tidy wipe), alternating drift. */
const ORDER = [3, 6, 1, 8, 0, 5, 2, 7, 4];
const DX = [14, -18, 11, -15, 17, -12, 15, -19, 13]; // vw
const DY = WALL.map((_, i) => (i - 4) * 2.6); // vh — rows peel away from center

/** Dispersal progress of row i: 0 until 0.15 + ORDER[i]·0.02, → 1 over 0.125. */
const disperse = (i: number): string =>
  `clamp(0, (var(--p, 0) - ${(0.15 + ORDER[i] * 0.02).toFixed(2)}) * 8, 1)`;

/** The error-rate curve — flat noise, the 03:17 spike, the long recovery. */
const CURVE =
  'M 0 168 C 60 166 120 170 180 166 C 240 162 280 168 320 150 ' +
  'C 344 138 356 60 380 34 C 398 16 408 52 424 96 ' +
  'C 448 158 500 172 560 174 C 620 176 680 172 720 173';

export function ActData() {
  return (
    <div className="relative h-full w-full">
      {/* 0–0.435 — THE WALL. Severity words fill the frame, then each row
          tears away: translate + blur + fade, all pure calc() of --p. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-[15vh] top-[9vh] flex flex-col items-center justify-between"
      >
        <p
          className="ns-mono text-[10px] tracking-[0.4em] text-white/30"
          style={{
            opacity: 'clamp(0, min((var(--p, 0) + 0.05) * 12, (0.3 - var(--p, 0)) * 8), 1)',
          }}
        >
          LOG STREAM · api-gateway · 03:16:12
        </p>
        {WALL.map((row, ri) => {
          const d = disperse(ri);
          return (
            <div
              key={ri}
              className="ns-mono flex justify-center gap-[3vw] text-[clamp(0.75rem,1.5vw,1.15rem)] tracking-[0.28em]"
              style={
                {
                  opacity: `min(clamp(0, (var(--p, 0) - ${(0.01 + ri * 0.009).toFixed(3)}) * 14, 1), calc(1 - ${d}))`,
                  transform: `translate(calc(${d} * ${DX[ri]}vw), calc(${d} * ${DY[ri]}vh))`,
                  filter: `blur(calc(${d} * 7px))`,
                  willChange: 'transform, filter, opacity',
                } as CSS
              }
            >
              {row.map((w, wi) => (
                <span key={wi} className={SEV_STYLE[w]}>
                  {w}
                </span>
              ))}
            </div>
          );
        })}
      </div>

      {/* 0.45–0.84 — THE GRAPH, mid-lower, beneath the pulsing diamond.
          A hairline curve draws itself (dashoffset ⇐ --p), annotations float. */}
      <div className="ns-seg absolute left-[6%] top-[59vh]" style={seg(0.46, 0.84, 12)}>
        <span className="ns-mono inline-block -rotate-90 text-[10px] tracking-[0.4em] text-white/35">
          ERROR RATE
        </span>
      </div>

      <div
        className="absolute left-[14%] right-[14%] top-[54vh] h-[22vh]"
        style={{ opacity: 'clamp(0, (0.86 - var(--p, 0)) * 8, 1)' }}
        data-e2e="data-curve"
      >
        <svg className="h-full w-full" viewBox="0 0 720 200" preserveAspectRatio="none">
          <path
            d={CURVE}
            pathLength={1}
            fill="none"
            stroke="rgba(255,255,255,0.45)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            strokeDasharray="1"
            style={{ strokeDashoffset: 'calc(1 - clamp(0, (var(--p, 0) - 0.47) * 4.2, 1))' } as CSS}
          />
        </svg>
      </div>

      <div
        className="ns-seg absolute left-[14%] right-[14%] top-[76.5vh] h-px bg-white/10"
        style={seg(0.48, 0.84, 10)}
      />
      <div
        className="ns-seg ns-mono absolute left-[14%] right-[14%] top-[78vh] flex justify-between text-[10px] text-white/25"
        style={seg(0.5, 0.84, 10)}
      >
        <span>03:00</span>
        <span>03:10</span>
        <span>03:20</span>
        <span>03:30</span>
        <span>03:40</span>
      </div>

      {/* the spike callout — hairline pointing back at the peak */}
      <div
        className="ns-seg absolute left-[57%] top-[56.5vh] flex items-center gap-2"
        style={seg(0.56, 0.8, 14)}
        data-e2e="data-spike"
      >
        <span className="h-px w-[4.5vw] bg-[#F16524]/70" />
        <span className="ns-mono text-[10px] font-bold tracking-[0.3em] text-[#FF8233]">
          SPIKE 03:17
        </span>
      </div>

      {/* the recovery tick — lands on the curve's settled tail */}
      <div
        className="ns-mono absolute left-[70%] top-[67vh] text-[11px] tracking-[0.3em] text-[#52D273]"
        style={
          {
            opacity: 'clamp(0, min((var(--p, 0) - 0.7) * 14, (0.86 - var(--p, 0)) * 10), 1)',
            transform: 'translateY(calc(clamp(0, (0.78 - var(--p, 0)) * 12, 1) * 10px))',
          } as CSS
        }
        data-e2e="data-recovered"
      >
        ✓ RECOVERED
      </div>

      {/* 0.78 → end — closing statement, bottom-anchored so it stays on
          screen through the scroll-away. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[8%] flex flex-col items-center px-6 text-center">
        <h2
          className="ns-seg ns-display text-[clamp(3rem,9.5vw,9.5rem)] leading-[0.92] text-[#F5F5F2]"
          style={seg(0.78, 1.5)}
          data-e2e="data-statement"
        >
          It doesn't just
          <br />
          detect the fire.
        </h2>
        <p className="ns-seg mt-5 text-base text-white/55 sm:text-lg" style={seg(0.85, 1.5, 18)}>
          It stays until the smoke clears.
        </p>
      </div>
    </div>
  );
}
