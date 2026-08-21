import { Link } from 'react-router-dom';
import './ActBuddy.css';

/**
 * ACT 07 — THE DAY SHIFT. The canvas diamond splits into two (0–0.5, keyframed
 * by the world engine — the upper-center stays clear for it). Below, the screen
 * becomes a code editor and Code Review Buddy reviews a PR live:
 * comment attaches → line is fixed → comment collapses to a resolved chip.
 * All choreography derives from --p (see ActBuddy.css + .ns-seg).
 */

const seg = (i: number, o: number, extra?: React.CSSProperties): React.CSSProperties =>
  ({ '--in': i, '--out': o, ...extra } as React.CSSProperties);

export function ActBuddy() {
  return (
    <div className="relative h-full w-full">
      {/* ——— 0.03–0.31: eyebrow + title (below the splitting diamonds) ——— */}
      <div className="pointer-events-none absolute inset-x-0 top-[38%] px-6 text-center">
        <p className="ns-seg ns-mono text-xs tracking-[0.35em] text-white/40" style={seg(0.03, 0.28)}>
          NIGHT SHIFT · DAY SHIFT
        </p>
        <h2
          className="ns-seg ns-display mt-6 text-[clamp(3.5rem,9.5vw,9rem)] text-[#F5F5F2]"
          style={seg(0.07, 0.31)}
        >
          Code Review Buddy
        </h2>
        <p className="ns-seg mx-auto mt-5 max-w-md text-white/55" style={seg(0.12, 0.31)}>
          The same AI, reviewing every pull request before a human opens it.
        </p>
      </div>

      {/* ——— 0.31–0.88: the gigantic editor — pinned to the LOWER half; the
          split diamonds own the sky above it ——— */}
      <div
        className="ns-seg pointer-events-none absolute left-1/2 top-[46%] w-[min(92vw,58rem)] -translate-x-1/2"
        style={seg(0.31, 0.88, { '--rise': '36px' } as React.CSSProperties)}
      >
        <div className="border border-white/10 bg-[#080808]/90 shadow-2xl">
          {/* editor chrome */}
          <div className="ns-mono flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-[11px] uppercase tracking-[0.2em] text-white/40">
            <div className="flex items-center gap-3">
              <span className="flex gap-1.5">
                <i className="h-2 w-2 rounded-full bg-white/15" />
                <i className="h-2 w-2 rounded-full bg-white/15" />
                <i className="h-2 w-2 rounded-full bg-white/15" />
              </span>
              <span>src/routes/user.ts · PR #214</span>
            </div>
            <span className="relative">
              <span className="buddy-old flex items-center gap-2" style={{ '--x': 0.7 } as React.CSSProperties}>
                <i className="ns-pulse h-1.5 w-1.5 rounded-full bg-[#F16524]" />
                review in progress
              </span>
              <span
                className="buddy-new absolute right-0 top-0 flex items-center gap-2 whitespace-nowrap text-[#52D273]"
                style={{ '--x': 0.7 } as React.CSSProperties}
              >
                <i className="h-1.5 w-1.5 rounded-full bg-[#52D273]" />
                approved
              </span>
            </span>
          </div>

          {/* the diff */}
          <div className="ns-mono px-4 py-3 text-left text-base leading-none">
            <div className="flex h-11 items-center text-white/30">
              <span className="w-12 select-none pr-3" />
              <span className="whitespace-pre">{'@@ -12,3 +12,5 @@ greetUser'}</span>
            </div>

            <div className="flex h-11 items-center">
              <span className="w-12 select-none pr-3 text-right text-white/25">12</span>
              <span className="whitespace-pre text-white/45">{'  async function greetUser(id: string) {'}</span>
            </div>

            <div className="flex h-11 items-center bg-emerald-500/[0.05]">
              <span className="w-12 select-none pr-3 text-right text-white/25">13</span>
              <span className="whitespace-pre text-emerald-300/80">{'+   const user = await getUser(id)'}</span>
            </div>

            {/* line 14 — second review cycle: floating promise → awaited */}
            <div className="relative flex h-11 items-center bg-emerald-500/[0.05]">
              <span className="w-12 select-none pr-3 text-right text-white/25">14</span>
              <span className="relative whitespace-pre text-emerald-300/80">
                <span className="buddy-old" style={{ '--x': 0.66 } as React.CSSProperties}>
                  {'+   saveAudit(id)'}
                </span>
                <span className="buddy-new absolute left-0 top-0 whitespace-pre" style={{ '--x': 0.66 } as React.CSSProperties}>
                  {'+   await saveAudit(id)'}
                </span>
              </span>
              <span
                className="buddy-wire absolute right-[15.75rem] top-1/2 hidden h-px w-40 bg-[#eab308]/40 lg:block"
                style={seg(0.55, 0.73)}
              />
              <span className="absolute right-3 top-1/2 z-20 hidden w-56 -translate-y-1/2 lg:block">
                <span className="buddy-slide block border border-white/15 bg-[#0D0D0D] p-2.5 text-left text-[11px] leading-relaxed shadow-xl" style={seg(0.55, 0.73)}>
                  <span className="font-bold text-[#eab308]">⚠ FLOATING PROMISE</span>
                  <span className="mt-0.5 block text-white/60">saveAudit is async — await it.</span>
                </span>
              </span>
              <span className="absolute right-3 top-1/2 z-10 -translate-y-1/2">
                <span
                  className="ns-seg inline-flex items-center gap-1.5 border border-[#52D273]/40 bg-[#52D273]/10 px-2 py-1 text-[10px] text-[#52D273]"
                  style={seg(0.69, 0.88, { '--rise': '6px' } as React.CSSProperties)}
                >
                  ✓ RESOLVED
                </span>
              </span>
            </div>

            {/* line 15 — headline review cycle: null access → optional chain */}
            <div className="relative flex h-11 items-center bg-emerald-500/[0.05]">
              <span className="w-12 select-none pr-3 text-right text-white/25">15</span>
              <span className="relative whitespace-pre text-emerald-300/80">
                <span className="buddy-old" style={{ '--x': 0.55 } as React.CSSProperties}>
                  {'+   return user.profile.name'}
                </span>
                <span className="buddy-new absolute left-0 top-0 whitespace-pre" style={{ '--x': 0.55 } as React.CSSProperties}>
                  {'+   return user.profile?.name ?? ’anonymous’'}
                </span>
              </span>
              <span
                className="buddy-wire absolute right-[15.75rem] top-1/2 hidden h-px w-40 bg-[#eab308]/40 lg:block"
                style={seg(0.38, 0.6)}
              />
              <span className="absolute right-3 top-1/2 z-20 hidden w-60 -translate-y-1/2 lg:block">
                <span className="buddy-slide block border border-white/15 bg-[#0D0D0D] p-3 text-left text-[11px] leading-relaxed shadow-xl" style={seg(0.38, 0.6)}>
                  <span className="font-bold text-[#eab308]">⚠ POSSIBLE NULL ACCESS</span>
                  <span className="mt-1 block text-white/60">
                    user.profile may be undefined. Suggested fix →
                  </span>
                </span>
              </span>
              <span className="absolute right-3 top-1/2 z-10 -translate-y-1/2">
                <span
                  className="ns-seg inline-flex items-center gap-1.5 border border-[#52D273]/40 bg-[#52D273]/10 px-2 py-1 text-[10px] text-[#52D273]"
                  style={seg(0.6, 0.88, { '--rise': '6px' } as React.CSSProperties)}
                >
                  ✓ RESOLVED
                </span>
              </span>
            </div>

            <div className="flex h-11 items-center">
              <span className="w-12 select-none pr-3 text-right text-white/25">16</span>
              <span className="whitespace-pre text-white/45">{'  }'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ——— 0.87–1: SHIP WITH CONFIDENCE ——— */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <h3
          className="ns-seg ns-display text-[clamp(3rem,9vw,8.5rem)] leading-[0.9] text-[#F5F5F2]"
          style={seg(0.87, 1.3)}
        >
          Ship with confidence.
        </h3>
        <Link
          to="/code-review"
          className="cursor-target ns-mono pointer-events-auto mt-10 inline-block border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.25em] text-white/70 transition-colors hover:text-white"
          style={{
            /* scale-gates the hit area to zero until its window opens */
            opacity: 'clamp(0, (var(--p, 0) - 0.88) * 10, 1)',
            transform: 'scale(clamp(0, (var(--p, 0) - 0.87) * 10, 1))',
          }}
        >
          [ Meet Code Review Buddy → ]
        </Link>
      </div>
    </div>
  );
}
