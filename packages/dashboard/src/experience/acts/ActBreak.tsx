/** ACT 02 — BREAK. 03:17 AM. The dashboard tears itself apart; nobody answers the page. */
import type { CSSProperties } from 'react';
import './ActBreak.css';

const seg = (inP: number, outP: number): CSSProperties =>
  ({ '--in': inP, '--out': outP }) as CSSProperties;

const tumble = (dx: number, dy: number, dr: number): CSSProperties =>
  ({ '--dx': dx, '--dy': dy, '--dr': dr }) as CSSProperties;

const GLASS = 'rounded-md border border-white/10 bg-white/[0.04] backdrop-blur-sm';

/** Error-rate sparkline: flat, flat, then the spike. */
const BARS = [34, 30, 36, 32, 31, 35, 33, 30, 34, 32, 38, 52, 74, 92, 88, 96];

const LOGS: Array<{ line: string; hot: boolean }> = [
  { line: '03:17:41  gateway  200  GET /api/v2/orders', hot: false },
  { line: '03:17:41  auth     200  POST /oauth/token', hot: false },
  { line: '03:17:42  db       ERR  connection pool exhausted', hot: true },
  { line: '03:17:42  gateway  502  GET /api/v2/orders', hot: true },
];

/** Huge dim timestamps rotating past in sequential windows. */
const STAMPS: Array<{ text: string; pos: string; rot: number; io: [number, number] }> = [
  { text: '03:17:42', pos: 'left-[4%] top-[9%]', rot: -3, io: [0.02, 0.28] },
  { text: '03:18:07', pos: 'right-[3%] top-[32%]', rot: 2.5, io: [0.22, 0.44] },
  { text: '03:18:15', pos: 'left-[7%] bottom-[12%]', rot: -2, io: [0.36, 0.58] },
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

      {/* the mini-dashboard: assembled at --p 0, disintegrates as --p grows */}
      <div className="absolute left-1/2 top-[45%] w-[min(88vw,56rem)] -translate-x-1/2 -translate-y-1/2">
        <div className="grid grid-cols-3 gap-3 text-left">
          <div
            className={`ns-break-card ${GLASS} col-span-3 flex items-center justify-between px-4 py-2.5`}
            style={tumble(60, -340, -8)}
          >
            <span className="ns-mono text-[10px] uppercase tracking-[0.3em] text-white/45">
              prod-dashboard
            </span>
            <span className="ns-mono text-[10px] text-white/30">live · 03:17 AM</span>
          </div>

          <div className={`ns-break-card ${GLASS} col-span-2 p-4`} style={tumble(-430, -180, -13)}>
            <p className="ns-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
              error rate
            </p>
            <div className="mt-3 flex h-16 items-end gap-[3px]">
              {BARS.map((h, i) => (
                <span
                  key={i}
                  className={`flex-1 ${i >= BARS.length - 5 ? 'bg-white/70' : 'bg-white/20'}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>

          <div className={`ns-break-card ${GLASS} p-4`} style={tumble(440, -260, 11)}>
            <p className="ns-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
              p99 latency
            </p>
            <p className="ns-mono mt-3 text-2xl text-white/90">
              2,340<span className="text-sm text-white/50"> ms</span>
            </p>
            <p className="ns-mono mt-1 text-[10px] text-white/50">▲ 612% vs 1h ago</p>
          </div>

          <div className={`ns-break-card ${GLASS} col-span-2 p-4`} style={tumble(-520, 150, 7)}>
            <p className="ns-mono text-[10px] uppercase tracking-[0.25em] text-white/40">services</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {['api-gateway', 'auth', 'payments', 'search', 'cdn', 'db-primary'].map((s) => (
                <span
                  key={s}
                  className="ns-mono rounded-full border border-white/15 px-2.5 py-0.5 text-[10px] text-white/50"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className={`ns-break-card ${GLASS} p-4`} style={tumble(500, 260, 18)}>
            <p className="ns-mono text-[10px] uppercase tracking-[0.25em] text-white/40">on-call</p>
            <p className="ns-mono mt-3 text-sm text-white/80">r. sharma</p>
            <p className="ns-mono mt-1 text-[10px] text-white/50">paged ×3 · no ack</p>
          </div>

          <div className={`ns-break-card ${GLASS} col-span-3 p-4`} style={tumble(-140, 420, -5)}>
            {LOGS.map((l) => (
              <p
                key={l.line}
                className={`ns-mono whitespace-pre text-[10px] leading-relaxed ${
                  l.hot ? 'text-white/80' : 'text-white/35'
                }`}
              >
                {l.line}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* the biggest statement of the act — silence around it */}
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <h2
          className="ns-seg ns-display text-center text-white"
          style={{ ...seg(0.45, 0.88), fontSize: 'clamp(3rem, 10.5vw, 11rem)' }}
        >
          Your on-call
          <br />
          engineer
          <br />
          is asleep.
        </h2>
      </div>

      {/* the responder comes online — canvas diamond enters center-right on this window */}
      <div className="ns-seg absolute bottom-[16%] left-[8%] md:left-[12%]" style={seg(0.78, 1.2)}>
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
