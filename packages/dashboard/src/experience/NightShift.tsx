import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ACTS, computeWorld } from './worldState';
import { DiamondCanvas, SceneDriver } from './DiamondScene';
import { InstrumentNav, ActIndicator } from './chrome';
import { TargetCursor } from '../components/primitives/TargetCursor';
import { Grain } from '../components/atmosphere';
import './nightshift.css';

import { ActHero } from './acts/ActHero';
import { ActBreak } from './acts/ActBreak';
import { ActEngine } from './acts/ActEngine';
import { ActPipeline } from './acts/ActPipeline';
import { ActData } from './acts/ActData';
import { ActMovie } from './acts/ActMovie';
import { ActBuddy } from './acts/ActBuddy';
import { ActProof } from './acts/ActProof';
import { ActFinale } from './acts/ActFinale';

/**
 * THE NIGHT SHIFT — the OnCall AI home experience.
 *
 * You enter a monitoring system at 02:47 AM. Something breaks. The whole page
 * becomes the incident: scroll is time, the orange diamond is the responder.
 *
 * Architecture (see worldState.ts): one passive scroll listener computes ONE
 * WorldState and pushes it everywhere — the canvas engine re-renders, each
 * act's <section> gets `--p` (its local 0..1 progress) and `data-live`, and
 * the act indicator is written directly. No per-component scroll handlers,
 * no rAF dependency for choreography.
 */

const ACT_COMPONENTS: ReactNode[] = [
  <ActHero key="hero" />,
  <ActBreak key="break" />,
  <ActEngine key="engine" />,
  <ActPipeline key="pipeline" />,
  <ActData key="data" />,
  <ActMovie key="movie" />,
  <ActBuddy key="buddy" />,
  <ActProof key="proof" />,
  <ActFinale key="finale" />,
];

function useStaticExperience(): boolean {
  const [staticMode] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
        window.innerWidth < 768),
  );
  return staticMode;
}

export function NightShift() {
  const staticMode = useStaticExperience();
  const driver = useMemo(() => new SceneDriver(), []);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (staticMode) return;
    const root = rootRef.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-ns-act]'));
    const num = root.querySelector<HTMLElement>('[data-ns-act-num]');
    const name = root.querySelector<HTMLElement>('[data-ns-act-name]');
    const bar = root.querySelector<HTMLElement>('[data-ns-act-bar]');
    const nav = root.querySelector<HTMLElement>('[data-ns-nav]');

    const apply = (): void => {
      const w = computeWorld(window.scrollY, window.innerWidth, window.innerHeight);
      driver.setWorld(w);
      root.style.setProperty('--wp', w.wp.toFixed(4));
      sections.forEach((el, i) => {
        const p = w.act === i ? w.ap : w.act > i ? 1 : 0;
        el.style.setProperty('--p', p.toFixed(4));
        el.dataset.live = w.act === i ? '1' : '0';
      });
      if (num) num.textContent = `${String(w.act + 1).padStart(2, '0')} / ${String(ACTS.length).padStart(2, '0')}`;
      if (name) name.textContent = ACTS[w.act].name;
      if (bar) bar.style.width = `${Math.round(w.ap * 96)}px`;
      // the instrument panel matters at the very top, then recedes
      if (nav) nav.style.opacity = w.wp < 0.04 ? '1' : w.act >= ACTS.length - 1 ? '1' : '0.25';
    };

    apply();
    window.addEventListener('scroll', apply, { passive: true });
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
    };
  }, [driver, staticMode]);

  // Marketing → console transition (brief §24): internal links don't just
  // navigate — the whole scene compresses and brightens for ~0.5s first, so
  // clicking OPEN DASHBOARD feels like entering the actual machine.
  const navigate = useNavigate();
  const collapsingRef = useRef(false);
  const onClickCapture = (e: React.MouseEvent): void => {
    const a = (e.target as HTMLElement).closest('a[href^="/"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (collapsingRef.current) return;
    collapsingRef.current = true;
    rootRef.current?.classList.add('ns-collapsing');
    window.setTimeout(() => navigate(a.getAttribute('href') ?? '/'), 520);
  };

  if (staticMode) return <StaticNight />;

  return (
    <div ref={rootRef} onClickCapture={onClickCapture} className="ns-root relative bg-[#030303] text-white">
      <DiamondCanvas driver={driver} />
      <Grain opacity={0.1} />
      <TargetCursor spinDuration={2.4} hoverDuration={0.2} cursorColorOnTarget="#F16524" />
      <InstrumentNav />
      <ActIndicator />

      <main className="relative z-10">
        {ACTS.map((act, i) => (
          <section
            key={act.id}
            data-ns-act={act.id}
            style={{ height: `${act.vh}vh` }}
            className="relative"
          >
            <div className="sticky top-0 flex h-screen w-full items-center justify-center overflow-hidden">
              {ACT_COMPONENTS[i]}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

/**
 * Reduced-motion / small-screen fallback: the same story told calmly — no
 * canvas, no choreography, everything readable and fast.
 */
function StaticNight() {
  return (
    <div className="min-h-screen bg-[#030303] px-6 py-16 text-white">
      <div className="mx-auto flex max-w-xl flex-col gap-12">
        <div className="flex items-center gap-2.5">
          <svg width={22} height={22} viewBox="0 0 256 256" fill="#F16524" aria-hidden>
            <path d="M 256 256 L 128 256 L 0 128 L 128 128 Z M 256 128 L 128 128 L 0 0 L 128 0 Z" />
          </svg>
          <span className="font-mono text-xs font-bold uppercase tracking-[0.3em]">OnCall AI</span>
        </div>
        <div>
          <p className="font-mono text-xs text-white/40">02:47:13 AM · status: nominal</p>
          <h1 className="mt-4 font-sans text-5xl font-black uppercase leading-[0.95]">
            Incidents happen.
          </h1>
          <p className="mt-4 text-white/60">
            Your AI incident responder. It detects in seconds, investigates with a real Claude
            agent, opens the fix as a pull request, and verifies recovery — while you sleep.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Link
            to="/dashboard"
            className="rounded-sm bg-[#F16524] px-6 py-3.5 text-center font-mono text-sm font-bold uppercase tracking-widest text-black"
          >
            [ Open Dashboard ]
          </Link>
          <Link
            to="/code-review"
            className="rounded-sm border border-white/20 px-6 py-3.5 text-center font-mono text-sm uppercase tracking-widest text-white/80"
          >
            Meet Code Review Buddy →
          </Link>
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/30">
          Sleep. We'll watch.
        </p>
      </div>
    </div>
  );
}
