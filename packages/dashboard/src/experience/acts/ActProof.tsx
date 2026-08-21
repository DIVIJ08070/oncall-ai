import { REAL_FINDINGS } from '../realFindings';
import type { RealFinding } from '../realFindings';
import './ActProof.css';

/**
 * ACT 08 — REAL PROOF. Not cards: a constellation of genuine Claude review
 * findings from this repo's actual pull requests, orbiting the canvas diamond
 * (which the world engine draws at 50%/50% this act). Nine chips at three
 * radii drift into place as --p advances (see ActProof.css).
 */

const SEV_COLOR: Record<RealFinding['sev'], string> = {
  critical: '#FF3B30',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
};

/** finding index → hardcoded polar-ish position (3 radii) + drift + window */
const ORBIT: { f: number; px: string; py: string; ox: string; oy: string; at: number }[] = [
  // inner radius
  { f: 0, px: '67%', py: '35%', ox: '44px', oy: '-30px', at: 0.1 },
  { f: 1, px: '31%', py: '63%', ox: '-36px', oy: '26px', at: 0.16 },
  // middle radius
  { f: 2, px: '25%', py: '29%', ox: '-40px', oy: '-34px', at: 0.13 },
  { f: 3, px: '75%', py: '66%', ox: '42px', oy: '30px', at: 0.22 },
  { f: 4, px: '50%', py: '15%', ox: '0px', oy: '-48px', at: 0.08 },
  // outer radius
  { f: 5, px: '12%', py: '48%', ox: '-56px', oy: '0px', at: 0.28 },
  { f: 6, px: '87%', py: '47%', ox: '56px', oy: '-6px', at: 0.19 },
  { f: 7, px: '26%', py: '80%', ox: '-38px', oy: '44px', at: 0.31 },
  { f: 9, px: '76%', py: '82%', ox: '40px', oy: '46px', at: 0.25 },
];

export function ActProof() {
  return (
    <div className="relative h-full w-full">
      <p
        className="ns-seg ns-mono absolute inset-x-0 top-[6%] text-center text-[11px] uppercase tracking-[0.35em] text-white/40"
        style={{ '--in': 0.03, '--out': 1.3 } as React.CSSProperties}
      >
        real reviews · real pull requests · this repo
      </p>

      {ORBIT.map(({ f, px, py, ox, oy, at }) => {
        const finding = REAL_FINDINGS[f];
        return (
          <div
            key={f}
            className="proof-chip hidden md:block"
            style={{ '--px': px, '--py': py, '--ox': ox, '--oy': oy, '--in': at } as React.CSSProperties}
          >
            <div className="proof-card ns-mono w-52 border border-white/10 bg-black/60 p-2.5 text-left">
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/35">
                <span
                  className="h-1.5 w-1.5 shrink-0"
                  style={{ background: SEV_COLOR[finding.sev] }}
                />
                <span>
                  {finding.sev} · PR #{finding.pr} · {finding.cat}
                </span>
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-white/60">{finding.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
