import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Play } from 'lucide-react';
import { GlowBackground, Magnet } from '../ui';
import {
  Parallax,
  ScrollReveal,
  ScrollWords,
} from '../../../../components/motion/scroll';
import { MonoTag } from '../../../../components/atmosphere';

const HERO_CSS = `
@keyframes crb-scrollcue {
  0%, 100% { transform: translateY(0); opacity: .55; }
  50% { transform: translateY(7px); opacity: 1; }
}
.crb-scrollcue { animation: crb-scrollcue 1.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .crb-scrollcue { animation: none; }
}
`;

/** Landing hero — full-viewport terminal intro with a giant phosphor headline. */
export function Hero() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 pb-28 pt-32 sm:px-6">
      <style>{HERO_CSS}</style>

      {/* Layered depth — solid phosphor bloom circles on parallax */}
      <GlowBackground />

      <Parallax
        speed={0.18}
        className="pointer-events-none absolute -left-40 -top-24 z-0 h-[560px] w-[560px]"
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            backgroundColor: 'var(--accent)',
            opacity: 0.07,
            filter: 'blur(110px)',
          }}
        />
      </Parallax>

      <Parallax
        speed={0.28}
        className="pointer-events-none absolute -right-32 top-1/3 z-0 h-[520px] w-[520px]"
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            backgroundColor: 'var(--accent)',
            opacity: 0.05,
            filter: 'blur(120px)',
          }}
        />
      </Parallax>

      <Parallax
        speed={0.12}
        className="pointer-events-none absolute bottom-[-120px] left-1/2 z-0 h-[360px] w-[720px] -translate-x-1/2"
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            backgroundColor: 'var(--accent)',
            opacity: 0.05,
            filter: 'blur(120px)',
          }}
        />
      </Parallax>

      {/* Content */}
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center text-center">
        <ScrollReveal y={16} className="mb-8">
          <MonoTag className="rounded-sm border border-border bg-surface-2 px-4 py-1.5">
            SYS / AI PULL REQUEST REVIEW
          </MonoTag>
        </ScrollReveal>

        <h1 className="text-6xl font-black uppercase leading-[0.9] tracking-tighter sm:text-7xl md:text-8xl lg:text-[8rem] xl:text-[9.5rem]">
          <ScrollWords
            text="SHIP BETTER PULL REQUESTS"
            className="crt-glow-strong text-ink"
          />
        </h1>

        <ScrollReveal
          y={24}
          blur
          delay={0.35}
          className="mt-9 max-w-2xl text-base text-ink-2 sm:text-lg"
        >
          <p>
            <span aria-hidden className="text-accent">
              &gt;{' '}
            </span>
            AI-powered pull request reviews that catch bugs, security issues,
            code smells, and missing tests &mdash; before a human even opens the
            PR.
          </p>
        </ScrollReveal>

        <ScrollReveal
          y={20}
          delay={0.5}
          className="mt-11 flex flex-col items-center gap-4 sm:flex-row"
        >
          <Magnet strength={0.25}>
            <Link
              to="/code-review/app"
              className="group inline-flex items-center gap-2 rounded-sm bg-primary px-8 py-3.5 font-bold uppercase tracking-[0.12em] text-black shadow-elev-2 transition-all duration-200 hover:scale-[1.03] hover:bg-primary-hover active:scale-[0.98]"
            >
              [ Review my code ]
              <ArrowRight
                size={18}
                className="transition-transform duration-200 group-hover:translate-x-1"
              />
            </Link>
          </Magnet>
          <a
            href="#how"
            className="group inline-flex items-center gap-2 rounded-sm border border-border-strong bg-surface-2 px-8 py-3.5 font-bold uppercase tracking-[0.12em] text-ink transition-colors duration-200 hover:bg-surface-3"
          >
            <Play
              size={16}
              className="transition-transform duration-200 group-hover:scale-110"
            />
            See how it works
          </a>
        </ScrollReveal>

        <ScrollReveal y={16} delay={0.65} className="mt-7">
          <MonoTag dot={false}>
            // POWERED BY GEMINI · NOTHING IS COMMITTED — REVIEW ONLY
          </MonoTag>
        </ScrollReveal>
      </div>

      {/* Scroll cue */}
      <a
        href="#how"
        aria-label="Scroll to learn more"
        className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 text-ink-muted-text transition-colors duration-200 hover:text-accent-text"
      >
        <span className="text-[10px] font-medium uppercase tracking-[0.3em]">
          Scroll
        </span>
        <ChevronDown size={18} className="crb-scrollcue" />
      </a>
    </section>
  );
}
