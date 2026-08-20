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
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
} from 'framer-motion';
import {
  Parallax,
  ScrollReveal,
  ScrollStagger,
  ScrollStaggerItem,
  ScrollWords,
} from '../../../../components/motion/scroll';

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

/** A glass feature card with a cursor-tracking spotlight and a soft 3D tilt. */
function FeatureCard({ feature }: { feature: Feature }) {
  const ref = useRef<HTMLDivElement>(null);
  const glowX = useMotionValue(0);
  const glowY = useMotionValue(0);
  const rotX = useMotionValue(0);
  const rotY = useMotionValue(0);
  const rotateX = useSpring(rotX, { stiffness: 150, damping: 18, mass: 0.3 });
  const rotateY = useSpring(rotY, { stiffness: 150, damping: 18, mass: 0.3 });
  const spotlight = useMotionTemplate`radial-gradient(240px circle at ${glowX}px ${glowY}px, rgba(241,101,36,0.18), transparent 70%)`;

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    glowX.set(e.clientX - rect.left);
    glowY.set(e.clientY - rect.top);
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
      className="group relative h-full overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-sm transition-colors duration-300 hover:border-white/20"
    >
      {/* cursor-tracking spotlight */}
      <motion.div
        aria-hidden
        style={{ background: spotlight }}
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      {/* top light-catching edge */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <div className="relative">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#F16524]/25 bg-[#F16524]/10 text-[#F16524] transition-all duration-300 group-hover:border-[#F16524]/50 group-hover:bg-[#F16524]/20 group-hover:shadow-[0_0_28px_-6px_rgba(241,101,36,0.55)]">
          <Icon size={22} />
        </div>
        <h3 className="mt-6 text-lg font-semibold text-white">
          {feature.title}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-white/50">
          {feature.body}
        </p>
      </div>
    </motion.div>
  );
}

/** Six-card feature grid — a scroll-in moment with alive, tilting glass cards. */
export function Features() {
  return (
    <section
      id="features"
      className="relative flex min-h-screen flex-col justify-center overflow-hidden px-4 py-32 sm:px-6 lg:py-40"
    >
      {/* layered depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]"
      />
      <Parallax
        speed={0.16}
        className="pointer-events-none absolute -left-40 top-16 h-[540px] w-[540px]"
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgba(241,101,36,0.13), transparent 70%)',
            filter: 'blur(50px)',
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
            background:
              'radial-gradient(closest-side, rgba(187,204,215,0.10), transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
      </Parallax>

      <div className="relative mx-auto w-full max-w-6xl">
        <ScrollReveal className="flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.22em] text-white/50">
            <span className="h-1.5 w-1.5 rounded-full bg-[#F16524]" />
            What it catches
          </span>
        </ScrollReveal>

        <h2 className="mx-auto mt-7 max-w-4xl text-center text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
          <ScrollWords
            text="Everything a senior reviewer checks"
            wordClassName="bg-[linear-gradient(180deg,#646973_0%,#BBCCD7_100%)] bg-clip-text text-transparent"
          />
        </h2>

        <ScrollReveal delay={0.1} className="mx-auto mt-6 max-w-xl">
          <p className="text-center text-white/50">
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
