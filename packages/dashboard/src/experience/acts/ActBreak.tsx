/** ACT 02 — BREAK. 03:17 AM. The 3D world carries the failure now: the payment
 * node tears red lower-center-right from ap ~0.25 and the diamond edge-enters
 * from the right at ~0.5 (see DiamondScene poseFor / NetworkWorld
 * updateNetwork). The DOM stays out of its way — no dashboard, no cards:
 * three floating log fragments disintegrate as the world fails, huge dim
 * timestamps rotate past, the colossal statement holds the upper-left, and a
 * small orange status marks the responder coming online lower-right as the
 * diamond arrives.
 *
 * Timing: the sticky viewport releases at --p = 1 − 100/220 ≈ 0.545; every
 * entrance completes by then, --out windows sit past 1 so late elements exit
 * by riding off with the slide (the responder line, pinned near the bottom,
 * is the last to leave while the fixed-canvas diamond keeps arriving).
 */
import type { CSSProperties } from 'react';
import './ActBreak.css';

const seg = (inP: number, outP: number, extra?: CSSProperties): CSSProperties =>
  ({ '--in': inP, '--out': outP, ...extra }) as CSSProperties;

/** --dx/--dy px drift, --dr deg, --fs = the --p at which the fragment's fade begins. */
const frag = (dx: number, dy: number, dr: number, fs: number): CSSProperties =>
  ({ '--dx': dx, '--dy': dy, '--dr': dr, '--fs': fs }) as CSSProperties;

/** The last log lines on screen — healthy dies first, the ERR next, the
    unanswered page lingers longest. All clear of the failing payment node
    (screen ~55–75vw / 60–78vh) and of the statement's upper-left block. */
const FRAGS: Array<{ text: string; pos: string; cls: string; v: CSSProperties }> = [
  {
    text: '03:17:41  gateway  200  GET /api/v2/orders',
    pos: 'left-[36%] top-[38%]',
    cls: 'text-white/40',
    v: frag(280, -380, 8, 0.16),
  },
  {
    text: '03:17:42  db  ERR  connection pool exhausted',
    pos: 'left-[10%] top-[27%]',
    cls: 'text-[#FF3B30]/75',
    v: frag(-420, -220, -10, 0.22),
  },
  {
    text: '03:18:03  pager  r. sharma  paged ×3 · no ack',
    pos: 'left-[16%] top-[57%]',
    cls: 'text-white/60',
    v: frag(-220, 470, -6, 0.28),
  },
];

/** Huge dim timestamps rotating past in sequential windows, composed to dodge
    the statement (upper-left, from 0.34) and the failing node (lower-right). */
const STAMPS: Array<{ text: string; pos: string; rot: number; io: [number, number] }> = [
  { text: '03:17:42', pos: 'left-[4%] top-[6%]', rot: -3, io: [0.02, 0.2] },
  { text: '03:18:07', pos: 'right-[3%] top-[30%]', rot: 2.5, io: [0.16, 0.34] },
  { text: '03:18:15', pos: 'left-[6%] bottom-[10%]', rot: -2, io: [0.3, 0.48] },
];

export function ActBreak() {
  return (
    <div className="relative h-full w-full">
      {/* time passing — huge, dim, behind everything */}
      {STAMPS.map((s) => (
        <div key={s.text} className={`ns-seg absolute ${s.pos}`} style={seg(s.io[0], s.io[1])}>
          <p
            className="ns-mono text-[11vw] leading-none text-white/[0.08]"
            style={{ transform: `rotate(${s.rot}deg)` }}
          >
            {s.text}
          </p>
        </div>
      ))}

      {/* the last log lines — assembled at --p 0, torn apart as the world fails */}
      {FRAGS.map((f) => (
        <p
          key={f.text}
          className={`ns-break-frag ns-mono absolute text-[11px] md:text-xs ${f.pos} ${f.cls}`}
          style={f.v}
        >
          {f.text}
        </p>
      ))}

      {/* the statement — colossal, upper-left, silence around it; lands while
          pinned as the last fragments die, rides off with the slide-out */}
      <h2
        className="ns-display pointer-events-none absolute left-[4vw] top-[8vh] text-white"
        style={{ fontSize: 'clamp(2.75rem, 10vw, 10.5rem)' }}
      >
        <span className="ns-seg block" style={seg(0.34, 1.2, { '--rise': '40px' } as CSSProperties)}>
          Your on-call
        </span>
        <span className="ns-seg block" style={seg(0.38, 1.2, { '--rise': '40px' } as CSSProperties)}>
          engineer
        </span>
        <span className="ns-seg block" style={seg(0.42, 1.2, { '--rise': '40px' } as CSSProperties)}>
          is asleep.
        </span>
      </h2>

      {/* the responder comes online — lower-right, as the diamond edge-enters
          (~0.5); anchored near the bottom, so it is the last DOM to ride off */}
      <div className="ns-seg absolute bottom-[10%] right-[5%] text-right" style={seg(0.48, 1.3)}>
        <p className="ns-mono text-xs font-medium tracking-[0.32em] text-[#F16524]">
          AI RESPONDER · ONLINE
        </p>
        <p className="ns-mono mt-2 text-[10px] tracking-[0.2em] text-white/35">
          detected 03:18:15 · engaged 03:18:22
        </p>
      </div>
    </div>
  );
}
