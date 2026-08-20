/** ACT 04 — THE PIPELINE. Not features: one log line crosses four stations
 *  and MORPHS at each — raw signal → understood context → mini-diff → green
 *  health sparkline — then dissolves into FROM SIGNAL TO RECOVERY.
 *  All choreography derives from the section's --p: the chip's left edge is
 *  8% + q4 × 76%, its inner stages are stacked .ns-seg layers, and each
 *  station activates via a clamp() window on --p. No listeners, no rAF.
 *
 *  TIMING: the sticky frame stays pinned only while --p ∈ [0, (280-100)/280
 *  ≈ 0.643]. The chip runs on q4 = clamp(--p × 1.7, 0, 1) so its crossing
 *  completes at --p ≈ 0.588; the colossal statement lands at release and
 *  rides the scroll-away. */

type CSS = React.CSSProperties;

const seg = (inAt: number, outAt: number, rise = 28): CSS =>
  ({ '--in': inAt, '--out': outAt, '--rise': `${rise}px` } as CSS);

/** Chip travel progress — done at --p ≈ 0.588 (see TIMING above). */
const Q4 = 'clamp(0, var(--p, 0) * 1.7, 1)';

/** The chip lives 0 → 0.60 (steeper-than-.ns-seg fade so the last morph reads). */
const CHIP_FADE = 'clamp(0, min((var(--p, 0) + 1) * 8, (0.6 - var(--p, 0)) * 12), 1)';

/** Stations sit exactly where the chip's center passes at each quarter's
 *  midpoint (center = 8% + q4 × 76% → q4 = .125/.375/.625/.875);
 *  each activates while the chip is in its quarter (--p windows). */
const STATIONS: ReadonlyArray<{ x: number; num: string; name: string; time: string; on: string }> = [
  {
    x: 17.5, num: '01', name: 'DETECT', time: '15.2s',
    on: 'clamp(0, min((var(--p, 0) + 1) * 16, (0.165 - var(--p, 0)) * 16), 1)',
  },
  {
    x: 36.5, num: '02', name: 'UNDERSTAND', time: '38s',
    on: 'clamp(0, min((var(--p, 0) - 0.13) * 16, (0.312 - var(--p, 0)) * 16), 1)',
  },
  {
    x: 55.5, num: '03', name: 'FIX', time: '1m 12s',
    on: 'clamp(0, min((var(--p, 0) - 0.277) * 16, (0.459 - var(--p, 0)) * 16), 1)',
  },
  {
    x: 74.5, num: '04', name: 'VERIFY', time: '1m 47s',
    on: 'clamp(0, min((var(--p, 0) - 0.424) * 16, (0.63 - var(--p, 0)) * 16), 1)',
  },
];

const SPARK = '0,6 14,10 28,7 42,12 56,22 70,24 84,23 98,24 112,23';

export function ActPipeline() {
  return (
    <div className="relative h-full w-full">
      {/* framing */}
      <div className="ns-seg absolute inset-x-0 top-[16vh] flex justify-center" style={seg(-0.2, 0.19, 14)}>
        <p className="ns-mono text-[11px] tracking-[0.34em] text-white/45">
          ONE LOG LINE. FOUR STATIONS.
        </p>
      </div>

      {/* travel guide — fades with the chip */}
      <div
        className="absolute left-0 right-0 h-px"
        style={{
          top: 'calc(36vh + 54px)',
          opacity: `calc(0.5 * ${CHIP_FADE})`,
          background:
            'repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0 6px, transparent 6px 14px)',
        }}
      />

      {/* ── THE CHIP — one object, morphing as it crosses ── */}
      <div
        className="absolute h-[108px] overflow-hidden rounded-md border border-white/[0.12] bg-[#0D0D0D]/70 shadow-[0_8px_40px_rgba(0,0,0,0.55)] backdrop-blur-md"
        style={{
          top: '36vh',
          left: `calc(8% + ${Q4} * 76%)`,
          width: 'min(340px, 44vw)',
          transform: 'translateX(-50%)',
          opacity: CHIP_FADE,
          willChange: 'left, opacity',
        }}
        data-e2e="pipeline-chip"
      >
        <p className="ns-mono absolute left-4 top-2.5 text-[9px] tracking-[0.25em] text-white/30">
          SIGNAL · PAY-8F31C2
        </p>

        {/* stage 1 — raw log */}
        <div className="ns-seg absolute inset-x-0 bottom-0 top-7 flex flex-col justify-center gap-1 px-4 pb-2" style={seg(-0.2, 0.2095, 10)}>
          <p className="ns-mono truncate text-[10px] text-white/40">
            03:17:42 · payment-service · production
          </p>
          <p className="ns-mono truncate text-[11px] text-white/85">
            TypeError: Cannot read properties of null ('token')
          </p>
        </div>

        {/* stage 2 — understood: highlighted context */}
        <div className="ns-seg absolute inset-x-0 bottom-0 top-7 flex flex-col justify-center gap-[3px] px-4 pb-2" style={seg(0.0845, 0.3565, 10)}>
          <p className="ns-mono truncate text-[10px] text-white/40">114 │ const s = sessions.get(uid)</p>
          <p className="ns-mono truncate border-l-2 border-[#F16524] bg-[#F16524]/10 pl-2 text-[10px] text-[#FF8233]">
            115 │ return s.token <span className="text-white/40">← null here</span>
          </p>
          <p className="ns-mono truncate text-[10px] text-white/40">116 │ {'}'}</p>
        </div>

        {/* stage 3 — the fix: mini-diff */}
        <div className="ns-seg absolute inset-x-0 bottom-0 top-7 flex flex-col justify-center gap-[3px] px-4 pb-2" style={seg(0.2315, 0.5035, 10)}>
          <p className="ns-mono truncate text-[10px]" style={{ color: 'rgba(229,83,75,0.92)' }}>
            -  return s.token
          </p>
          <p className="ns-mono truncate text-[10px]" style={{ color: 'rgba(63,185,80,0.92)' }}>
            +  if (!s) return retry(uid)
          </p>
          <p className="ns-mono truncate text-[10px]" style={{ color: 'rgba(63,185,80,0.92)' }}>
            +  return s.token
          </p>
        </div>

        {/* stage 4 — verified: green health sparkline */}
        <div className="ns-seg absolute inset-x-0 bottom-0 top-7 flex items-center gap-3 px-4 pb-2" style={seg(0.3785, 2, 10)}>
          <svg width={112} height={28} viewBox="0 0 112 28" className="shrink-0">
            <polyline points={SPARK} fill="none" stroke="#3fb950" strokeWidth={2} />
          </svg>
          <span className="flex min-w-0 flex-col">
            <span className="ns-mono truncate text-[10px] text-[#3fb950]">error rate → 0.02%</span>
            <span className="ns-mono truncate text-[9px] text-white/40">checkout recovered</span>
          </span>
        </div>
      </div>

      {/* ── STATIONS ── */}
      <div className="ns-seg absolute inset-x-0 top-[58vh] h-24" style={seg(-0.2, 0.62, 0)}>
        {STATIONS.map((st) => (
          <div
            key={st.num}
            className="absolute top-0 text-center"
            style={{
              left: `${st.x}%`,
              transform: `translateX(-50%) scale(calc(1 + 0.08 * ${st.on}))`,
            }}
            data-e2e={`pipeline-station-${st.num}`}
          >
            <div className="relative">
              <div className="ns-mono text-[10px] tracking-[0.3em] text-white/30">{st.num}</div>
              <div className="ns-mono mt-1 text-xs tracking-[0.22em] text-white/55">{st.name}</div>
              <div className="ns-mono mt-1 text-[9px] tracking-[0.2em] text-white/30">{st.time}</div>
              <div className="absolute inset-0" style={{ opacity: st.on }}>
                <div className="ns-mono text-[10px] tracking-[0.3em] text-[#FF8233]/70">{st.num}</div>
                <div
                  className="ns-mono mt-1 text-xs tracking-[0.22em] text-[#F16524]"
                  style={{ textShadow: '0 0 14px rgba(241,101,36,0.55)' }}
                >
                  {st.name}
                </div>
                <div className="ns-mono mt-1 text-[9px] tracking-[0.2em] text-[#FF8233]/80">{st.time}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── FINALE ── */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <h2
          className="ns-seg ns-display text-6xl text-white sm:text-7xl lg:text-8xl"
          style={seg(0.56, 1.5)}
          data-e2e="pipeline-finale"
        >
          From signal
          <br />
          to recovery.
        </h2>
        <p className="ns-seg ns-mono mt-6 text-[11px] tracking-[0.34em] text-white/40" style={seg(0.62, 1.5, 12)}>
          MEDIAN 1M 47S · WHILE YOU SLEPT
        </p>
      </div>
    </div>
  );
}
