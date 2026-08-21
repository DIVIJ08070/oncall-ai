/**
 * ACT 06 — A REAL NIGHT, REPLAYED. Vertical scroll drives a HORIZONTAL world:
 * a 436vw filmstrip of timestamp scenes slides left as --p advances, and every
 * scene brightens as it crosses viewport center. The mechanics stay hidden —
 * just moments passing in the dark, ending on the payoff, alone on black.
 *
 * Track math: scenes 0–6 are 44vw wide after a 28vw lead-in, the payoff is a
 * full 100vw. translateX = min(--p, .92) * -365.2174vw, so scene i is dead
 * center at --p = 44i/365.2174 and the payoff locks to center at .92 and holds
 * for the act's last 8% (the previous scene is fully off-screen there).
 */

const BEATS: [string, string][] = [
  ['03:17:42', 'Something breaks. Logs start accumulating.'],
  ['03:17:57', 'OnCall detects it.'],
  ['03:18:11', 'Agent starts the investigation.'],
  ['03:18:46', 'Root cause identified.'],
  ['03:19:12', 'Pull request opened.'],
  ['03:20:31', 'Human approves.'],
  ['03:21:04', 'Recovery verified.'],
];

/** --p at which scene i sits at viewport center: 44i / (336 / 0.92). */
const F = 336 / 0.92;
const CENTERS = BEATS.map((_, i) => (44 * i) / F);

const TICK_HEIGHTS = [5, 9, 4, 12, 6, 15, 8, 18, 22, 11, 26];

const GLYPHS = [
  // 0 — logs accumulating: rising tick marks
  <span key="g0" className="flex items-end gap-[3px]">
    {TICK_HEIGHTS.map((h, j) => (
      <span key={j} className="w-px bg-white/35" style={{ height: h }} />
    ))}
  </span>,
  // 1 — the detection ping (the one orange moment of the strip)
  <span key="g1" className="flex items-center gap-3">
    <span className="relative flex h-4 w-4 items-center justify-center">
      <span className="absolute inset-0 rounded-full border border-[#F16524]/40" />
      <span className="ns-pulse h-1.5 w-1.5 rounded-full bg-[#F16524]" />
    </span>
    <span>anomaly · p99 latency</span>
  </span>,
  // 2 — the magnifier line
  <span key="g2" className="flex items-center gap-3">
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="6.5" cy="6.5" r="4.5" stroke="white" strokeOpacity="0.55" fill="none" />
      <path d="M10 10 L14.5 14.5" stroke="white" strokeOpacity="0.55" />
    </svg>
    <span>tracing 14 services</span>
  </span>,
  // 3 — the pinpoint
  <span key="g3" className="text-white/55">└─ db/pool.ts:114 · connections exhausted</span>,
  // 4 — the branch + PR number
  <span key="g4" className="flex items-center gap-3">
    <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden>
      <circle cx="3" cy="3" r="2" stroke="white" strokeOpacity="0.55" fill="none" />
      <circle cx="3" cy="13" r="2" stroke="white" strokeOpacity="0.55" fill="none" />
      <circle cx="11" cy="8" r="2" stroke="white" strokeOpacity="0.55" fill="none" />
      <path d="M3 5 v6 M11 10 c0 2 -4 3 -6 3" stroke="white" strokeOpacity="0.55" fill="none" />
    </svg>
    <span>PR #4127 · fix: raise pool ceiling</span>
  </span>,
  // 5 — the human, briefly
  <span key="g5" className="text-white/55">@maya approved · LGTM</span>,
  // 6 — the green all-clear
  <span key="g6" className="text-emerald-400/80">✓ error rate nominal · 5xx 0.02%</span>,
];

export function ActMovie() {
  return (
    <div className="absolute inset-0">
      <div
        className="relative flex h-full"
        style={
          {
            width: '436vw',
            paddingLeft: '28vw',
            transform: 'translateX(calc(min(var(--p, 0), 0.92) * -365.2174vw))',
            willChange: 'transform',
          } as React.CSSProperties
        }
      >
        {/* one continuous night — a faint timeline behind the scenes, ending
            exactly where the payoff begins (track x 336vw) */}
        <div aria-hidden className="absolute left-0 top-1/2 h-px w-[336vw] bg-white/5" />

        {BEATS.map(([t, msg], i) => {
          const c = CENTERS[i].toFixed(4);
          return (
            <div
              key={t}
              className="flex h-full w-[44vw] shrink-0 flex-col justify-center px-[3vw]"
              style={
                {
                  opacity: `clamp(0.15, 1 - max(var(--p, 0) - ${c}, ${c} - var(--p, 0)) * 6.5, 1)`,
                  transform: `scale(calc(1 - min(max(var(--p, 0) - ${c}, ${c} - var(--p, 0)), 0.2) * 0.25))`,
                } as React.CSSProperties
              }
            >
              <p className="ns-mono text-[clamp(3rem,7vw,7.5rem)] font-bold leading-none tracking-tight text-white/[0.15]">
                {t}
              </p>
              <p className="mt-6 max-w-[30vw] text-xl font-medium leading-tight text-[#F5F5F2] sm:text-[1.7rem]">
                {msg}
              </p>
              <div className="ns-mono mt-8 flex h-6 items-center text-[11px] tracking-[0.18em] text-white/45">
                {GLYPHS[i]}
              </div>
            </div>
          );
        })}

        {/* the payoff — locks to center at --p .92, alone, full-viewport */}
        <div
          className="flex h-full w-[100vw] shrink-0 items-center justify-center px-6"
          style={
            {
              opacity: 'clamp(0, 1 - (0.92 - var(--p, 0)) * 4, 1)',
              transform: 'scale(calc(0.94 + clamp(0, (var(--p, 0) - 0.67) * 0.24, 0.06)))',
            } as React.CSSProperties
          }
        >
          <h2 className="ns-display text-center text-[clamp(4rem,12vw,12rem)] leading-[0.9] text-[#F5F5F2]">
            You slept
            <br />
            through it.
          </h2>
        </div>
      </div>
    </div>
  );
}
