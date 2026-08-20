import { useRef } from 'react';
import type { MouseEvent } from 'react';
import {
  BadgeCheck,
  Bug,
  FlaskConical,
  Radar,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import {
  Parallax,
  ScrollReveal,
  ScrollStagger,
  ScrollStaggerItem,
  ScrollWords,
} from '../../../../components/motion/scroll';
import { MonoTag } from '../../../../components/atmosphere';

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: Bug,
    title: 'Bug Detection',
    body: 'Null checks, off-by-ones, race conditions and logic slips — caught before they ship.',
  },
  {
    icon: ShieldCheck,
    title: 'Security Scan',
    body: 'Injection, hardcoded secrets, unsafe input handling and other risky patterns flagged instantly.',
  },
  {
    icon: Radar,
    title: 'Code Smell Radar',
    body: 'Duplication, god functions and tangled dependencies surfaced with concrete fixes.',
  },
  {
    icon: FlaskConical,
    title: 'Missing-Test Finder',
    body: 'Spots the code paths your diff touches that no test covers.',
  },
  {
    icon: BadgeCheck,
    title: 'Best-Practice Checks',
    body: 'Idiomatic patterns for your language and framework, checked on every review.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Custom Team Rules',
    body: 'Encode your own architecture, naming and hygiene rules — reviewed like the built-ins.',
  },
];

/** A terminal module card with a soft 3D tilt and phosphor hover glow. */
function FeatureCard({ feature }: { feature: Feature }) {
  const ref = useRef<HTMLDivElement>(null);
  const rotX = useMotionValue(0);
  const rotY = useMotionValue(0);
  const rotateX = useSpring(rotX, { stiffness: 150, damping: 18, mass: 0.3 });
  const rotateY = useSpring(rotY, { stiffness: 150, damping: 18, mass: 0.3 });

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    rotY.set((px - 0.5) * 9);
    rotX.set((0.5 - py) * 9);
  };

  const handleLeave = () => {
    rotX.set(0);
    rotY.set(0);
  };

  const Icon = feature.icon;

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      whileHover={{ scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 220, damping: 20 }}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      className="group relative h-full overflow-hidden rounded-sm border border-border bg-surface-2 p-8 transition-all duration-300 hover:border-border-strong hover:shadow-elev-2"
    >
      {/* top phosphor hairline that lights up on hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary opacity-0 transition-opacity duration-300 group-hover:opacity-40"
      />

      <div className="relative">
        <div className="flex h-12 w-12 items-center justify-center rounded-sm border border-border-strong bg-surface-3 text-accent transition-shadow duration-300 group-hover:shadow-elev-2">
          <Icon size={22} />
        </div>
        <h3 className="crt-glow mt-6 text-lg font-semibold uppercase tracking-[0.06em] text-ink">
          {feature.title}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted-text">
          {feature.body}
        </p>
      </div>
    </motion.div>
  );
}

/** Six-card feature grid — a scroll-in moment with alive, tilting terminal modules. */
export function Features() {
  return (
    <section
      id="features"
      className="relative flex min-h-screen flex-col justify-center overflow-hidden px-4 py-32 sm:px-6 lg:py-40"
    >
      <Parallax
        speed={0.16}
        className="pointer-events-none absolute -left-40 top-16 h-[540px] w-[540px]"
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            backgroundColor: 'var(--accent)',
            opacity: 0.04,
            filter: 'blur(70px)',
          }}
        />
      </Parallax>
      <Parallax
        speed={-0.12}
        className="pointer-events-none absolute -right-32 bottom-8 h-[520px] w-[520px]"
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

      <div className="relative mx-auto w-full max-w-6xl">
        <ScrollReveal className="flex justify-center">
          <MonoTag className="rounded-sm border border-border bg-surface-2 px-4 py-1.5">
            WHAT IT CATCHES
          </MonoTag>
        </ScrollReveal>

        <div className="mt-6 flex justify-center">
          <MonoTag>SYS / CAPABILITIES</MonoTag>
        </div>

        <h2 className="mx-auto mt-7 max-w-4xl text-center text-4xl font-black uppercase leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
          <ScrollWords
            text="Everything a senior reviewer checks"
            wordClassName="crt-glow-strong text-ink"
          />
        </h2>

        <ScrollReveal delay={0.1} className="mx-auto mt-6 max-w-xl">
          <p className="text-center text-ink-muted-text">
            Five built-in review categories plus your own team rules — run
            against every diff, in seconds.
          </p>
        </ScrollReveal>

        <ScrollStagger className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <ScrollStaggerItem key={feature.title} className="h-full">
              <FeatureCard feature={feature} />
            </ScrollStaggerItem>
          ))}
        </ScrollStagger>
      </div>
    </section>
  );
}
