/** ACT 04 — THE PIPELINE. Not features: one log line crosses four stations
 *  and MORPHS at each — raw signal → understood context → mini-diff → green
 *  health sparkline — then dissolves into FROM SIGNAL / TO RECOVERY.
 *  The canvas diamond escorts the chip from ABOVE (pose y 1.05, small), so
 *  the whole traveling apparatus sits LOW: chip at 52vh, stations at 70vh,
 *  a wide band of empty night between them and the escort.
 *  All choreography derives from the section's --p: the chip's left edge is
 *  8% + q4 × 76%, its inner stages are stacked .ns-seg layers, and each
 *  station activates via a clamp() window on --p. No listeners, no rAF.
 *
 *  TIMING: the sticky frame stays pinned only while --p ∈ [0, (280-100)/280
 *  ≈ 0.643]. The chip runs on q4 = clamp(--p × 1.7, 0, 1) so its crossing
 *  completes at --p ≈ 0.588; the two colossal lines land 0.54 / 0.60 —
 *  the second beat rides the scroll-away, ActFinale-style. */

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
      {/* framing — gone before the escort diamond crosses center */}
      <div className="ns-seg absolute inset-x-0 top-[16vh] flex justify-center" style={seg(-0.2, 0.19, 14)}>
        <p className="ns-mono text-[11px] tracking-[0.34em] text-white/45">
          ONE LOG LINE. FOUR STATIONS.
        </p>
      </div>

      {/* travel guide — fades with the chip */}
      <div
        className="absolute left-0 right-0 h-px"
        style={{
          top: 'calc(52vh + 54px)',
          opacity: `calc(0.5 * ${CHIP_FADE})`,
          background:
            'repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0 6px, transparent 6px 14px)',
        }}
      />

      {/* ── THE CHIP — one object, morphing as it crosses. Squared, hairline. ── */}
      <div
        className="absolute h-[108px] overflow-hidden border border-white/[0.12] bg-[#0A0A0A]/80 shadow-[0_8px_40px_rgba(0,0,0,0.55)]"
        style={{
          top: '52vh',
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

        {/* stage 3 — the fix: mini-diff (red #FF3B30 / green #52D273) */}
        <div className="ns-seg absolute inset-x-0 bottom-0 top-7 flex flex-col justify-center gap-[3px] px-4 pb-2" style={seg(0.2315, 0.5035, 10)}>
          <p className="ns-mono truncate text-[10px]" style={{ color: 'rgba(255,59,48,0.92)' }}>
            -  return s.token
          </p>
          <p className="ns-mono truncate text-[10px]" style={{ color: 'rgba(82,210,115,0.92)' }}>
            +  if (!s) return retry(uid)
          </p>
          <p className="ns-mono truncate text-[10px]" style={{ color: 'rgba(82,210,115,0.92)' }}>
            +  return s.token
          </p>
        </div>

        {/* stage 4 — verified: green health sparkline */}
        <div className="ns-seg absolute inset-x-0 bottom-0 top-7 flex items-center gap-3 px-4 pb-2" style={seg(0.3785, 2, 10)}>
          <svg width={112} height={28} viewBox="0 0 112 28" className="shrink-0">
            <polyline points={SPARK} fill="none" stroke="#52D273" strokeWidth={2} />
          </svg>
          <span className="flex min-w-0 flex-col">
            <span className="ns-mono truncate text-[10px] text-[#52D273]">error rate → 0.02%</span>
            <span className="ns-mono truncate text-[9px] text-white/40">checkout recovered</span>
          </span>
        </div>
      </div>

      {/* ── STATIONS — low, under the traveling rig ── */}
      <div className="ns-seg absolute inset-x-0 top-[70vh] h-24" style={seg(-0.2, 0.62, 0)}>
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

      {/* ── FINALE — two colossal stacked lines, a beat apart ── */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 pb-[10vh] text-center">
        <h2
          className="ns-display text-[clamp(3.5rem,11vw,11rem)] leading-[0.92] text-[#F5F5F2]"
          data-e2e="pipeline-finale"
        >
          <span className="ns-seg block" style={seg(0.54, 1.5, 36)}>
            From signal
          </span>
          <span className="ns-seg block" style={seg(0.6, 1.5, 36)}>
            to recovery.
          </span>
        </h2>
        <p className="ns-seg ns-mono mt-7 text-[11px] tracking-[0.34em] text-white/40" style={seg(0.64, 1.5, 12)}>
          MEDIAN 1M 47S · WHILE YOU SLEPT
        </p>
      </div>
    </div>
  );
}
