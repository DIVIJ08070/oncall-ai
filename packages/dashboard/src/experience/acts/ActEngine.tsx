/** ACT 03 — THE INCIDENT ENGINE. A spatial timeline the camera travels:
 *  DETECT → INVESTIGATE → FIX → VERIFY. The act's --p (written on
 *  <section data-ns-act="engine"> by the scroll engine) drives a 260vw plane
 *  via translateX; the canvas diamond rides the same rail LOW in frame
 *  (pose y -0.25, rail at 60vh) — so every DOM composition sits HIGH and the
 *  3D world shows through beneath. Every reveal is a pure function of --p:
 *  .ns-seg windows, .ns-char indices, inline clamp() math. No listeners,
 *  no rAF.
 *
 *  TIMING: the sticky frame stays pinned only while --p ∈ [0, (340-100)/340
 *  ≈ 0.706] — after that the whole screen scrolls away (the act handoff).
 *  So the camera runs on q = clamp(--p × 1.515, 0, 1): the full journey
 *  completes at --p ≈ 0.66 and RECOVERED lands just before release. */

type CSS = React.CSSProperties;

/** .ns-seg window helper. */
const seg = (inAt: number, outAt: number, rise = 28): CSS =>
  ({ '--in': inAt, '--out': outAt, '--rise': `${rise}px` } as CSS);

/** Camera progress: journey done at --p = 0.66 (see TIMING above). */
const Q = 'clamp(0, var(--p, 0) * 1.515, 1)';

/* ── ZONE DETECT ─────────────────────────────────────────────────────── */

const LOGS: ReadonlyArray<{ text: string; hot?: boolean }> = [
  { text: '03:17:12.041  api-gw      200 GET /v1/health 12ms' },
  { text: '03:17:18.377  payments    worker heartbeat ok' },
  { text: '03:17:23.902  checkout    cart.updated user=48211' },
  { text: '03:17:29.118  payments    session.created eu-west-1' },
  { text: '03:17:31.436  api-gw      200 POST /v1/checkout 210ms' },
  { text: "03:17:42.008  payments    TypeError: reading 'token' of null", hot: true },
  { text: '03:17:42.114  api-gw      500 POST /v1/checkout 8ms' },
  { text: '03:17:42.201  alerts      page: ERROR_RATE_SPIKE' },
];

const ERROR_LINE = Array.from('ERROR RATE ↑ 17.4%');

/* ── ZONE INVESTIGATE ────────────────────────────────────────────────── */

const TERMINAL: ReadonlyArray<{ text: string; at: number; tone: 'dim' | 'body' | 'orange' }> = [
  { text: 'Claude Agent ─────────────────────────────', at: 0.106, tone: 'dim' },
  { text: '> Analyzing recent deploy…', at: 0.139, tone: 'body' },
  { text: '> diff 8f31c2…e04d11 · payments/session.ts', at: 0.165, tone: 'body' },
  { text: '> Suspected regression: payments-service@8f31c2', at: 0.191, tone: 'body' },
  { text: 'Confidence: 94%', at: 0.218, tone: 'orange' },
];

/* ── ZONE FIX ────────────────────────────────────────────────────────── */

const DIFF: ReadonlyArray<{ kind: 'meta' | 'ctx' | 'del' | 'add'; text: string }> = [
  { kind: 'meta', text: '@@ services/payments/session.ts @@' },
  { kind: 'ctx', text: '  export function paymentToken(user) {' },
  { kind: 'del', text: '-   const session = payments.getSession(user.id)' },
  { kind: 'del', text: '-   return session.token' },
  { kind: 'add', text: '+   const session = payments.getSession(user?.id)' },
  { kind: 'add', text: '+   if (!session) return retryCheckout(user)' },
  { kind: 'add', text: '+   return session.token' },
  { kind: 'ctx', text: '  }' },
];

/* failure red #FF3B30 · recovery green #52D273 (art direction) */
const DIFF_STYLE: Record<'meta' | 'ctx' | 'del' | 'add', CSS> = {
  meta: { color: 'rgba(255,255,255,0.32)' },
  ctx: { color: 'rgba(255,255,255,0.45)' },
  del: { color: 'rgba(255,59,48,0.92)', background: 'rgba(255,59,48,0.07)' },
  add: { color: 'rgba(82,210,115,0.92)', background: 'rgba(82,210,115,0.07)' },
};

/* ── ZONE VERIFY ─────────────────────────────────────────────────────── */

const CURVE = 'M 8 24 C 94 18 136 42 184 82 C 226 116 302 136 352 140';

/* ── RAIL NODES — active while the camera is in their zone ───────────── */

const NODES: ReadonlyArray<{ x: number; label: string; on: string }> = [
  {
    x: 32.5,
    label: 'DETECTED ● 15 SEC',
    on: 'clamp(0, min((var(--p, 0) + 1) * 15, (0.12 - var(--p, 0)) * 15), 1)',
  },
  {
    x: 97.5,
    label: 'INVESTIGATING ● 38 SEC',
    on: 'clamp(0, min((var(--p, 0) - 0.086) * 15, (0.31 - var(--p, 0)) * 15), 1)',
  },
  {
    x: 162.5,
    label: 'FIXING ● 1M 12S',
    on: 'clamp(0, min((var(--p, 0) - 0.284) * 15, (0.508 - var(--p, 0)) * 15), 1)',
  },
  {
    x: 227.5,
    label: 'VERIFYING ● 1M 47S',
    on: 'clamp(0, (var(--p, 0) - 0.482) * 15, 1)',
  },
];

const ZONE_TAGS = ['ZONE 01 — DETECT', 'ZONE 02 — INVESTIGATE', 'ZONE 03 — FIX', 'ZONE 04 — VERIFY'];

const GLOW = '0 0 14px rgba(241,101,36,0.55)';

export function ActEngine() {
  return (
    <div className="relative h-full w-full">
      {/* THE PLANE — 260vw of night the camera tracks across. */}
      <div
        className="absolute inset-y-0 left-0"
        style={{
          width: '260vw',
          transform: `translateX(calc(${Q} * -180vw))`,
          willChange: 'transform',
        }}
      >
        {/* zone separators — faint spatial structure */}
        {[65, 130, 195].map((x) => (
          <div
            key={x}
            className="absolute top-[15vh] h-[70vh] w-px bg-white/5"
            style={{ left: `${x}vw` }}
          />
        ))}

        {/* zone signage */}
        {ZONE_TAGS.map((tag, i) => (
          <p
            key={tag}
            className="ns-mono absolute top-[7vh] text-[10px] tracking-[0.34em] text-white/25"
            style={{ left: `${i * 65 + 6}vw` }}
          >
            {tag}
          </p>
        ))}

        {/* ── ZONE DETECT (0–65vw) — the failure, in red ── */}
        <div className="absolute top-0 flex h-[54vh] w-[65vw] items-center justify-center px-[5vw]" style={{ left: 0 }}>
          <div className="flex flex-col items-start">
            <div className="ns-mono whitespace-pre text-xs leading-[1.8] md:text-[13px]">
              {LOGS.map((l, i) => (
                <p
                  key={l.text}
                  className={`ns-seg ${l.hot ? 'text-[#FF3B30]' : 'text-white/35'}`}
                  style={seg(l.hot ? 0.04 : -0.08 + i * 0.0132, 0.33, 14)}
                >
                  {l.text}
                </p>
              ))}
            </div>
            {/* the moment: per-character materialize via .ns-char */}
            <p
              className="ns-seg ns-display mt-8 text-[clamp(2.5rem,5.2vw,5rem)] text-[#FF3B30]"
              style={{ ...seg(-0.2, 0.37, 0), textShadow: '0 0 34px rgba(255,59,48,0.35)' }}
              data-e2e="engine-errorline"
            >
              {ERROR_LINE.map((c, i) => (
                <span key={i} className="ns-char" style={{ '--ci': 0.066 + i * 0.0033 } as CSS}>
                  {c === ' ' ? ' ' : c}
                </span>
              ))}
            </p>
          </div>
        </div>

        {/* ── ZONE INVESTIGATE (65–130vw) — squared terminal, hairline border ── */}
        <div className="absolute top-0 flex h-[54vh] w-[65vw] items-center justify-center px-[5vw]" style={{ left: '65vw' }}>
          <div
            className="ns-seg w-full max-w-[640px] border border-white/10 bg-[#030303]/60 p-6 md:p-8"
            style={seg(0.092, 0.42)}
            data-e2e="engine-terminal"
          >
            <div className="ns-mono flex flex-col gap-2.5 text-left text-sm leading-relaxed md:text-base xl:text-lg">
              {TERMINAL.map((line) => (
                <p
                  key={line.text}
                  className={`ns-seg whitespace-pre ${
                    line.tone === 'dim'
                      ? 'text-white/45'
                      : line.tone === 'orange'
                        ? 'font-bold text-[#F16524]'
                        : 'text-white/75'
                  }`}
                  style={seg(line.at, 0.41, 12)}
                >
                  {line.text}
                </p>
              ))}
              <p className="ns-seg" style={seg(0.23, 0.41, 0)}>
                <span className="ns-caret text-[#F16524]">▌</span>
              </p>
            </div>
          </div>
        </div>

        {/* ── ZONE FIX (130–195vw) — the diff, floating, no chrome ── */}
        <div className="absolute top-0 flex h-[54vh] w-[65vw] items-center justify-center px-[5vw]" style={{ left: '130vw' }}>
          <div className="flex flex-col items-start">
            <div className="ns-mono whitespace-pre text-base leading-relaxed lg:text-xl xl:text-2xl">
              {DIFF.map((l, i) => (
                <p
                  key={l.text}
                  className={`ns-seg ${l.kind === 'meta' ? 'mb-2 text-sm lg:text-base' : 'px-2'}`}
                  style={{ ...seg(0.29 + i * 0.0145, 0.7, 20), ...DIFF_STYLE[l.kind] }}
                >
                  {l.text}
                </p>
              ))}
            </div>
            <div
              className="ns-seg mt-8 inline-flex items-center gap-3 border border-white/10 bg-[#030303]/60 px-5 py-3.5"
              style={seg(0.435, 0.75)}
              data-e2e="engine-pr"
            >
              <span className="h-2 w-2 rounded-full bg-[#52D273]" />
              <span className="ns-mono text-sm text-white/80 md:text-base">
                PULL REQUEST OPENED · <span className="font-bold text-[#F16524]">#1842</span>
                <span className="text-white/45"> · fix: null payment session</span>
              </span>
            </div>
          </div>
        </div>

        {/* ── ZONE VERIFY (195–260vw) — floating chart, then RECOVERED. colossal ── */}
        <div
          className="absolute top-0 flex h-full w-[65vw] flex-col items-center px-[5vw] pt-[7vh]"
          style={{ left: '195vw', '--vv': 'clamp(0, (var(--p, 0) - 0.515) * 6.9, 1)' } as CSS}
        >
          <div className="ns-seg flex flex-col items-start" style={seg(0.475, 1.4, 24)} data-e2e="engine-chart">
            <p className="ns-mono mb-3 text-[10px] tracking-[0.3em] text-white/35">
              ERROR RATE · PAYMENTS-SERVICE
            </p>
            <div className="relative h-[160px] w-[360px]">
              <svg width={360} height={160} viewBox="0 0 360 160" className="absolute inset-0">
                <line x1={8} y1={24} x2={352} y2={24} stroke="rgba(255,255,255,0.07)" strokeDasharray="3 5" />
                <line x1={8} y1={140} x2={352} y2={140} stroke="rgba(255,255,255,0.07)" strokeDasharray="3 5" />
                {/* the curve heals: red → orange → green, all from --vv (⇐ --p) */}
                <path d={CURVE} fill="none" stroke="#FF3B30" strokeWidth={2.5}
                  style={{ opacity: 'calc(1 - clamp(0, var(--vv) * 2.2, 1))' } as CSS} />
                <path d={CURVE} fill="none" stroke="#F16524" strokeWidth={2.5}
                  style={{ opacity: 'clamp(0, min(var(--vv) * 4, (0.85 - var(--vv)) * 4), 1)' } as CSS} />
                <path d={CURVE} fill="none" stroke="#52D273" strokeWidth={2.5}
                  style={{ opacity: 'clamp(0, (var(--vv) - 0.55) * 3.3, 1)' } as CSS} />
              </svg>
              <span className="ns-mono absolute left-2 top-1 text-[9px] text-white/30">17.4%</span>
              <span className="ns-mono absolute bottom-1 right-2 text-[9px] text-white/30">
                0.02%
                <span className="absolute inset-0 text-[#52D273]"
                  style={{ opacity: 'clamp(0, (var(--vv) - 0.75) * 4, 1)' } as CSS}>
                  0.02%
                </span>
              </span>
              {/* the responder's reading — a dot sliding down the healing curve */}
              <div
                className="absolute left-0 top-0 h-2 w-2 rounded-full bg-[#F16524]"
                style={{
                  offsetPath: `path('${CURVE}')`,
                  offsetDistance: 'calc(var(--vv) * 100%)',
                  boxShadow: '0 0 10px rgba(241,101,36,0.9)',
                } as CSS}
              />
            </div>
          </div>
          <h2
            className="ns-seg ns-display mt-[4vh] whitespace-nowrap text-[clamp(4rem,11vw,11.5rem)] leading-[0.9] text-[#F5F5F2]"
            style={seg(0.575, 1.4)}
            data-e2e="engine-recovered"
          >
            Recovered.
          </h2>
          <p className="ns-seg ns-mono mt-5 text-[11px] tracking-[0.34em] text-white/40" style={seg(0.625, 1.4, 12)}>
            1M 47S · NO HUMAN PAGED
          </p>
        </div>

        {/* ── THE RAIL — full plane width; fill trails the diamond ── */}
        <div className="absolute left-0 top-[60vh] h-px w-full bg-white/15" />
        <div
          className="absolute left-0 top-[60vh] h-px bg-[#F16524]"
          style={{
            width: `min(calc(${Q} * 180vw + 12vw + var(--p, 0) * 76vw), 260vw)`,
            boxShadow: '0 0 12px rgba(241,101,36,0.5)',
          }}
          data-e2e="engine-rail"
        />
        {NODES.map((n) => (
          <div key={n.x} className="absolute" style={{ left: `${n.x}vw`, top: '60vh' }}>
            <span className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/25" />
            <span
              className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#F16524]"
              style={{ opacity: n.on, boxShadow: '0 0 12px rgba(241,101,36,0.9)' }}
            />
            <div className="ns-mono absolute left-0 top-[72px] -translate-x-1/2 whitespace-nowrap text-center text-[10px] tracking-[0.3em]">
              <span className="text-white/35">{n.label}</span>
              <span className="absolute inset-0 text-[#F16524]" style={{ opacity: n.on, textShadow: GLOW }}>
                {n.label}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
