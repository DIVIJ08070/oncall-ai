import { Link } from 'react-router-dom';

/**
 * NIGHT SHIFT chrome — not a navbar, an instrument panel. A minimal HUD that
 * matters at the top of the experience and shrinks to a floating act indicator
 * once you're inside (the indicator's text is driven by the scroll engine via
 * direct DOM writes — see NightShift).
 */

export function InstrumentNav() {
  return (
    <header
      data-ns-nav
      className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-5 py-4 transition-opacity duration-500 md:px-8"
    >
      <Link to="/" className="flex items-center gap-2.5">
        <svg width={20} height={20} viewBox="0 0 256 256" fill="#F16524" aria-hidden>
          <path d="M 256 256 L 128 256 L 0 128 L 128 128 Z M 256 128 L 128 128 L 0 0 L 128 0 Z" />
        </svg>
        <span className="font-mono text-xs font-bold uppercase tracking-[0.3em] text-white/90">
          OnCall AI
        </span>
      </Link>

      <nav className="hidden items-center gap-6 font-mono text-[11px] uppercase tracking-[0.22em] text-white/45 md:flex">
        <Link className="transition-colors hover:text-white" to="/dashboard">System</Link>
        <Link className="transition-colors hover:text-white" to="/incidents">Incidents</Link>
        <Link className="transition-colors hover:text-white" to="/code-review">Code Review</Link>
        <Link className="transition-colors hover:text-white" to="/demo">Demo</Link>
      </nav>

      <Link
        to="/dashboard"
        className="rounded-sm bg-[#F16524] px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-black transition-transform hover:scale-[1.04]"
      >
        [ Open Dashboard ]
      </Link>
    </header>
  );
}

/** "01 / 09 ── ACT NAME" — contents written directly by the scroll engine. */
export function ActIndicator() {
  return (
    <div
      aria-hidden
      className="fixed bottom-6 left-5 z-40 select-none font-mono text-[10px] uppercase tracking-[0.3em] text-white/40 md:left-8"
    >
      <div data-ns-act-num>01 / 09</div>
      <div className="my-1.5 h-px w-24 bg-white/15">
        <div data-ns-act-bar className="h-px w-0 bg-[#F16524] transition-[width] duration-200" />
      </div>
      <div data-ns-act-name className="text-white/60">THE NIGHT SHIFT</div>
      <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.3em] text-white/30">
        AI STATUS · <span className="text-[#F16524]" data-ns-ai-status>OBSERVING</span>
      </p>
    </div>
  );
}
