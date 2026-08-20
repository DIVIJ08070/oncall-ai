import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { FallingText } from '../components/primitives/FallingText';
import { TargetCursor } from '../components/primitives/TargetCursor';
import { Grain, Scanlines, AtmosphereBackdrop, HudCorners, MonoTag } from '../components/atmosphere';
import { TypeText, BootLines, Cursor } from '../components/motion/terminal';

/**
 * 404 — a terminal crash screen. The route lookup kernel-panicked: phosphor
 * stack trace, a giant glowing 404 with a blinking cursor, and the explanatory
 * sentence as a physics sandbox — hover and the words collapse into a pile you
 * can shove around, the crash made literal. The way back is plain text above it.
 */
export function NotFoundPage() {
  useEffect(() => {
    document.title = '404 - Page Not Found';
    return () => {
      document.title = 'OnCall AI';
    };
  }, []);

  // Crosshair tint resolved from the theme token so no hex lives in this file
  // (TargetCursor feeds the value straight to gsap, which can't parse var()).
  const [accent] = useState(() =>
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || 'currentColor'
      : 'currentColor',
  );

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-bg">
      {/* Film grain + scanlines over the whole viewport — the lost-signal texture. */}
      <Grain />
      <Scanlines />

      {/* Faint phosphor HUD grid, behind everything. */}
      <AtmosphereBackdrop />

      {/* Crosshair pointer — brand surfaces only; the console keeps the real cursor. */}
      <TargetCursor spinDuration={2} hoverDuration={0.2} cursorColorOnTarget={accent} />

      {/* Decorative mono coordinate readout — a HUD frozen at the moment of signal loss. */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-6 left-6 z-10 hidden select-none flex-col gap-1 font-mono text-[9px] uppercase leading-relaxed tracking-[0.3em] text-ink-muted-text opacity-40 sm:flex"
      >
        <span>LAT 40.7128</span>
        <span>LON -074.006</span>
        <span>SIG // LOST</span>
      </div>

      <header className="relative z-10 flex items-center justify-between px-5 py-5 md:px-8">
        <Link to="/" className="cursor-target flex items-center gap-2">
          <svg width={22} height={22} viewBox="0 0 256 256" className="text-accent" fill="currentColor" aria-hidden="true">
            <path d="M 256 256 L 128 256 L 0 128 L 128 128 Z M 256 128 L 128 128 L 0 0 L 128 0 Z" />
          </svg>
          <span className="font-playfair crt-glow text-xl text-ink">OnCall AI</span>
        </Link>
        <Link
          to="/dashboard"
          className="cursor-target rounded-sm border border-border-strong px-4 py-2 font-mono text-xs font-medium uppercase tracking-[0.2em] text-ink transition-colors hover:bg-surface-3"
        >
          Dashboard
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-5 pt-6 text-center">
        {/* Hairline viewfinder brackets frame the content column like a HUD.
            text-accent drives currentColor so the 1px brackets read phosphor. */}
        <HudCorners size={22} inset={4} className="text-accent" />

        {/* HUD eyebrow — the panic signature, in the atmosphere's mono voice. */}
        <MonoTag className="mb-6">PANIC // ERR_404 // ROUTE_NOT_FOUND</MonoTag>

        {/* The crash code itself: bold phosphor mono, full glow, cursor still
            blinking — the machine halted mid-thought. */}
        <p className="font-playfair crt-glow-strong crt-flicker text-[clamp(88px,18vw,190px)] leading-none text-accent">
          404
          <Cursor className="text-[0.5em]" />
        </p>

        <h1 className="crt-glow mt-7 font-mono text-xl font-medium text-ink-2 sm:text-2xl">
          <TypeText text="kernel panic: page not found" delay={250} />
        </h1>

        {/* Fake stack trace — where the route died, one frame at a time. */}
        <BootLines
          delay={1200}
          interval={220}
          className="mt-6 text-left font-mono text-[11px] leading-relaxed text-ink-muted-text"
          lines={[
            'at router.resolve (/srv/oncall/router.ts:404:13)',
            'at RouteTable.match (/srv/oncall/routes.ts:88:9)',
            'at kernel.dispatch (/srv/oncall/init.ts:1:1)',
          ]}
        />

        {/* The sentence falls apart on hover — drag the words around. */}
        <div className="mt-4 h-[220px] w-full sm:h-[240px]">
          <FallingText
            text="This page slipped through the cracks. Hover or tap to watch it fall apart, then head back to safety."
            highlightWords={['slipped', 'fall', 'cracks.']}
            trigger="hover"
            gravity={0.56}
            mouseConstraintStiffness={0.9}
            fontSize="1.25rem"
            className="text-ink-2"
          />
        </div>

        <EscapingHomeButton />
      </main>
    </div>
  );
}

/** Taunts shown as the button dodges; the last one is where it gives up. */
const DODGE_LABELS = ['Back to Home', 'Nope.', 'Too slow!', 'Almost…', 'Fine, you win.'];
const MAX_DODGES = DODGE_LABELS.length - 1;

/**
 * The "Back to Home" button plays keep-away: it darts to a random spot each time
 * the pointer reaches it, taunting as it goes — then gives up after a few tries
 * and sits still.
 *
 * It is never actually unclickable: it stays a real link the whole time (a fast
 * click still lands), it never dodges keyboard focus, and it holds still
 * entirely for touch users and anyone who prefers reduced motion. The joke is
 * allowed to be funny, not to trap someone on a dead-end page.
 */
function EscapingHomeButton() {
  const [dodges, setDodges] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const skipRef = useRef(false);

  useEffect(() => {
    skipRef.current =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      window.matchMedia('(hover: none)').matches;
  }, []);

  const caught = dodges >= MAX_DODGES;

  const dodge = (): void => {
    if (skipRef.current || caught) return;
    setDodges((d) => d + 1);
    // Jump somewhere else in the row, biased away from where it just was.
    setOffset((prev) => {
      const x = (Math.random() * 2 - 1) * 150;
      const y = (Math.random() * 2 - 1) * 42;
      return { x: Math.abs(x - prev.x) < 70 ? -x : x, y };
    });
  };

  // Once caught, glide back to centre so it reads as a normal button again.
  const shown = caught ? { x: 0, y: 0 } : offset;

  return (
    <div className="relative mb-14 flex h-[132px] w-full items-center justify-center">
      <Link
        to="/"
        onMouseEnter={dodge}
        style={{ transform: `translate(${shown.x}px, ${shown.y}px)` }}
        className="cursor-target inline-flex items-center gap-2 rounded-sm bg-primary px-7 py-3 font-mono text-sm font-semibold uppercase tracking-[0.12em] text-bg transition-transform duration-300 ease-out hover:bg-primary-hover"
      >
        <ArrowLeft className="h-4 w-4" />
        {DODGE_LABELS[Math.min(dodges, MAX_DODGES)]}
      </Link>
    </div>
  );
}
