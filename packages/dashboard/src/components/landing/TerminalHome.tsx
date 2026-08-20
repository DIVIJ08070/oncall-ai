import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BootLines, TypeText } from '../motion/terminal';
import { Press } from '../motion/primitives';
import { AtmosphereBackdrop, Grain, HudCorners, MonoTag, Scanlines } from '../atmosphere';
import { TargetCursor } from '../primitives/TargetCursor';

/**
 * TerminalHome — the public `/` landing as a full-screen amber phosphor CRT.
 * One viewport, no scroll: titlebar, boot sequence into a massive phosphor
 * headline, a live log ticker, then the product line + CTAs pinned to the
 * bottom corners. Presentation only; all navigation is plain react-router.
 */

const NAV: { label: string; to: string }[] = [
  { label: 'dashboard', to: '/dashboard' },
  { label: 'incidents', to: '/incidents' },
  { label: 'connect', to: '/onboarding' },
  { label: 'demo', to: '/demo' },
  { label: 'code-review', to: '/code-review' },
];

const TICKER_LINES = [
  '12:04:11 checkout-api p95 412ms',
  'deploy v2.31.4 -> api-gateway ok',
  'WARN redis-cache evictions rising',
  'INC-2041 resolved in 11m by agent',
  'db-primary connections 82/100',
  'alert routed -> @priya (primary on-call)',
  'trace 8f2c41 root cause: connection pool exhausted',
  'postmortem draft ready for review',
  'synthetic probe eu-west-1 200 OK',
  'error budget 99.2% remaining',
];

/* Local CSS: nav hover glow + the one-line log marquee (same pattern as the
   CRB marquee — duplicated track, translateX(-50%), paused on hover). */
const LOCAL_CSS = `
.th-link:hover, .th-link:focus-visible {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 4px;
  text-shadow: 0 0 6px color-mix(in srgb, var(--accent) 45%, transparent);
}
@keyframes th-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
.th-track { animation: th-marquee 46s linear infinite; }
.th-ticker:hover .th-track { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .th-track { animation: none; }
}
`;

const OK = <span className="text-ok-text">ok</span>;

function TickerRow({ hidden }: { hidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={hidden}>
      {TICKER_LINES.map((line, i) => (
        <span key={i} className="mx-6 whitespace-nowrap text-xs text-ink-muted-text">
          <span aria-hidden className="mr-2 text-accent-text">
            {'>'}
          </span>
          {line}
        </span>
      ))}
    </div>
  );
}

/** One-line infinite log ticker in dim amber. */
function LogTicker() {
  return (
    <div className="th-ticker overflow-hidden border-y border-border py-2" aria-hidden>
      <div className="th-track flex w-max">
        <TickerRow />
        <TickerRow hidden />
      </div>
    </div>
  );
}

export function TerminalHome() {
  const [booted, setBooted] = useState(false);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-bg text-ink">
      <style>{LOCAL_CSS}</style>

      {/* Crosshair pointer — brand surfaces only. */}
      <TargetCursor spinDuration={2} hoverDuration={0.2} cursorColor="var(--accent)" />

      {/* CRT atmosphere */}
      <Grain opacity={0.14} />
      <Scanlines opacity={0.5} />
      <AtmosphereBackdrop />
      <HudCorners size={22} inset={10} className="z-30" />

      {/* The screen */}
      <div className="crt-flicker relative z-10 flex min-h-screen flex-1 flex-col px-5 pb-5 pt-5 sm:px-9 sm:pb-7 sm:pt-6">
        {/* Titlebar */}
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border pb-3">
          <MonoTag>
            ONCALL.AI — TTY1 <span className="text-ok-text">[LIVE]</span>
          </MonoTag>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="th-link cursor-target font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted-text transition-colors"
              >
                {'> '}
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        {/* Hero: boot sequence, then the phosphor headline */}
        <main className="flex flex-1 flex-col justify-center py-8">
          <BootLines
            delay={250}
            interval={230}
            className="mb-6 font-mono text-xs leading-6 text-ink-muted-text sm:text-sm"
            lines={[
              <span key="0">
                <span className="text-accent-text">$</span> oncall v0.1.0 — pager daemon
              </span>,
              <span key="1">{'> '}loading detectors … {OK}</span>,
              <span key="2">{'> '}watching checkout-api … {OK}</span>,
              <span key="3">{'> '}wiring pagers … {OK}</span>,
              <span key="4">{'> '}agent standing by _</span>,
            ]}
            onDone={() => setBooted(true)}
          />

          {booted && (
            <h1 className="crt-glow-strong font-mono text-5xl font-bold uppercase leading-[1.04] tracking-tight text-accent sm:text-6xl lg:text-7xl xl:text-8xl">
              <span className="block">Incidents happen.</span>
              <TypeText
                text="We are already on it."
                speed={42}
                delay={200}
                cursor
                className="block"
              />
            </h1>
          )}
        </main>

        {/* Live log ticker */}
        <LogTicker />

        {/* Bottom: product line + CTAs */}
        <footer className="mt-5 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <p className="max-w-sm font-mono text-xs leading-relaxed text-ink-muted-text">
            <span aria-hidden className="text-accent-text">
              {'// '}
            </span>
            OnCall AI watches your logs, deploys, and dependencies; when something breaks it pages
            itself first — tracing the root cause and drafting the fix before you unlock your
            phone.
          </p>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <Press>
              <Link
                to="/dashboard"
                className="cursor-target inline-block rounded-none bg-primary px-6 py-3 font-mono text-sm font-bold uppercase tracking-[0.18em] text-black transition-colors hover:bg-primary-hover"
              >
                [ open dashboard ]
              </Link>
            </Press>
            <Link
              to="/code-review"
              className="th-link cursor-target font-mono text-xs uppercase tracking-[0.22em] text-ink-muted-text transition-colors"
            >
              {'> '}see code review
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
