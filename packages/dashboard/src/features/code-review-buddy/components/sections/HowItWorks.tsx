import { useRef } from 'react';
import type { ReactNode } from 'react';
import { FileDiff, Gauge, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
} from 'framer-motion';
import {
  Parallax,
  ScrollReveal,
  ScrollWords,
} from '../../../../components/motion/scroll';
import { MonoTag } from '../../../../components/atmosphere';

interface Step {
  number: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    number: '01',
    icon: FileDiff,
    title: 'Paste a diff or drop a repo',
    body: 'Drop in a raw diff — or point us at any public GitHub repo URL. No install, no setup.',
  },
  {
    number: '02',
    icon: Sparkles,
    title: 'Gemini reads every line',
    body: 'Your code is analyzed against 5 built-in review categories plus your own custom team rules.',
  },
  {
    number: '03',
    icon: Gauge,
    title: 'Get a score you can act on',
    body: 'A 0-100 score with severity-tagged findings you can copy straight in as a PR comment.',
  },
];

const EASE = [0.16, 1, 0.3, 1] as const;

function useStatic(): boolean {
  const reduced = useReducedMotion();
  return (
    Boolean(reduced) ||
    (typeof document !== 'undefined' && document.visibilityState === 'hidden')
  );
}

/** Reveal that slides in horizontally from a given side (blank-safe). */
function SlideIn({
  children,
  from,
  className,
}: {
  children: ReactNode;
  from: 'left' | 'right';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -15% 0px' });
  if (useStatic()) return <div className={className}>{children}</div>;
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, x: from === 'left' ? -64 : 64, filter: 'blur(8px)' }}
      animate={inView ? { opacity: 1, x: 0, filter: 'blur(0px)' } : undefined}
      transition={{ duration: 0.75, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** One station on the timeline: rail node, ghost numeral, and a terminal card. */
function StepRow({ step, index }: { step: Step; index: number }) {
  const side: 'left' | 'right' = index % 2 === 0 ? 'left' : 'right';
  const Icon = step.icon;

  return (
    <div className="relative grid grid-cols-1 items-center gap-x-12 md:grid-cols-2">
      {/* rail node */}
      <div
        aria-hidden
        className="absolute left-5 top-1 -translate-x-1/2 md:left-1/2 md:top-1/2 md:-translate-y-1/2"
      >
        <div
          className="flex h-12 w-12 items-center justify-center rounded-sm border border-border-strong bg-bg text-accent"
          style={{ boxShadow: '0 0 0 7px var(--bg), var(--elev-2)' }}
        >
          <Icon size={20} />
        </div>
      </div>

      {/* content card */}
      <SlideIn
        from={side}
        className={
          side === 'left'
            ? 'pl-16 md:col-start-1 md:row-start-1 md:pl-0 md:pr-16 md:text-right'
            : 'pl-16 md:col-start-2 md:row-start-1 md:pl-16 md:pr-0 md:text-left'
        }
      >
        <div className="relative overflow-hidden rounded-sm border border-border bg-surface-2 p-7 transition-colors duration-300 hover:border-border-strong">
          <span className="crt-glow text-xs font-semibold uppercase tracking-[0.22em] text-accent-text">
            Step {step.number}
          </span>
          <h3 className="mt-3 text-xl font-semibold text-ink sm:text-2xl">
            {step.title}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted-text">
            {step.body}
          </p>
        </div>
      </SlideIn>

      {/* oversized ghost numeral on the opposite side (desktop only) */}
      <div
        aria-hidden
        className={
          side === 'left'
            ? 'pointer-events-none hidden select-none md:col-start-2 md:row-start-1 md:block md:pl-16 md:text-left'
            : 'pointer-events-none hidden select-none md:col-start-1 md:row-start-1 md:block md:pr-16 md:text-right'
        }
      >
        <span className="text-[9rem] font-black leading-none tracking-tighter text-surface-3">
          {step.number}
        </span>
      </div>
    </div>
  );
}

/** Three-step scroll journey with a rail that fills with phosphor as you go. */
export function HowItWorks() {
  const railRef = useRef<HTMLDivElement>(null);
  const isStatic = useStatic();
  const { scrollYProgress } = useScroll({
    target: railRef,
    offset: ['start 70%', 'end 65%'],
  });
  const fill = useSpring(scrollYProgress, {
    stiffness: 80,
    damping: 26,
    mass: 0.5,
  });

  return (
    <section
      id="how"
      className="relative flex min-h-screen flex-col justify-center overflow-hidden px-4 py-32 sm:px-6 lg:py-40"
    >
      <Parallax
        speed={0.14}
        className="pointer-events-none absolute right-[-160px] top-24 h-[520px] w-[520px]"
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            backgroundColor: 'var(--accent)',
            opacity: 0.04,
            filter: 'blur(75px)',
          }}
        />
      </Parallax>
      <Parallax
        speed={-0.1}
        className="pointer-events-none absolute left-[-140px] bottom-16 h-[480px] w-[480px]"
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            backgroundColor: 'var(--accent)',
            opacity: 0.03,
            filter: 'blur(80px)',
          }}
        />
      </Parallax>

      <div className="relative mx-auto w-full max-w-5xl">
        <ScrollReveal className="flex justify-center">
          <MonoTag className="rounded-sm border border-border bg-surface-2 px-4 py-1.5">
            HOW IT WORKS
          </MonoTag>
        </ScrollReveal>

        <div className="mt-6 flex justify-center">
          <MonoTag>FLOW / 3 STEPS</MonoTag>
        </div>

        <h2 className="mx-auto mt-7 max-w-3xl text-center text-4xl font-black uppercase leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
          <ScrollWords
            text="From diff to PR comment in three moves"
            wordClassName="crt-glow-strong text-ink"
          />
        </h2>

        {/* the journey */}
        <div ref={railRef} className="relative mt-20">
          {/* rail track */}
          <div
            aria-hidden
            className="absolute left-5 top-0 h-full w-px -translate-x-1/2 md:left-1/2"
            style={{ backgroundColor: 'var(--border)' }}
          />
          {/* rail fill — grows with scroll, solid phosphor */}
          {isStatic ? (
            <div
              aria-hidden
              className="absolute left-5 top-0 h-full w-px -translate-x-1/2 md:left-1/2"
              style={{
                backgroundColor: 'var(--accent)',
                boxShadow: '0 0 12px var(--accent)',
              }}
            />
          ) : (
            <motion.div
              aria-hidden
              className="absolute left-5 top-0 h-full w-px origin-top -translate-x-1/2 md:left-1/2"
              style={{
                scaleY: fill,
                backgroundColor: 'var(--accent)',
                boxShadow: '0 0 12px var(--accent)',
              }}
            />
          )}

          <div className="space-y-16 md:space-y-28">
            {STEPS.map((step, index) => (
              <StepRow key={step.number} step={step} index={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
