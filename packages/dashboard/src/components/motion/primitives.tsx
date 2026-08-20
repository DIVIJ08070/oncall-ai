import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, useSpring, useTransform } from 'motion/react';

/**
 * Console motion primitives (motion/react) — the shared vocabulary for interior
 * animation, tuned to the ui-ux-pro-max "Stagger List (Standard)" pattern:
 * 300-450ms, y 16, scale .92, ~60ms stagger, springy ease-out.
 *
 * Every primitive renders its FINAL state immediately when the document is
 * hidden or the user prefers reduced motion: hidden documents freeze rAF (so
 * entrance tweens would leave content invisible in embedded previews), and the
 * reduced-motion contract for an ops console is "content first, garnish never".
 */

/** True → skip animation and render final state. */
export function useStaticEntrance(): boolean {
  // Frozen at mount (see scroll.tsx): never flip from static→motion after a
  // visibility change, which would strand content at opacity:0.
  const [staticMode] = useState(
    () =>
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ||
      (typeof document !== 'undefined' && document.visibilityState === 'hidden'),
  );
  return staticMode;
}

const EASE = [0.16, 1, 0.3, 1] as const;

/** Single-element fade-up entrance. */
export function Entrance({
  children,
  delay = 0,
  y = 16,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const staticEntry = useStaticEntrance();
  if (staticEntry) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Wave-staggered container: wrap children in <StaggerItem>. */
export function StaggerGroup({
  children,
  className,
  each = 0.06,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  each?: number;
  delay?: number;
}) {
  const staticEntry = useStaticEntrance();
  if (staticEntry) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: each, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const staticEntry = useStaticEntrance();
  if (staticEntry) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 16, scale: 0.92 },
        show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Numeric value that springs to its target when it changes (KPIs, scores).
 * Formatting stays caller-owned via `format`.
 */
export function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const staticEntry = useStaticEntrance();
  const spring = useSpring(value, { stiffness: 120, damping: 22 });
  const text = useTransform(spring, (v) => format(v));
  const ref = useRef<HTMLSpanElement>(null);
  const [initial] = useState(() => format(value));

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  useEffect(() => {
    if (staticEntry) return;
    const unsub = text.on('change', (v) => {
      if (ref.current) ref.current.textContent = v;
    });
    return unsub;
  }, [text, staticEntry]);

  if (staticEntry) return <span className={className}>{format(value)}</span>;
  return (
    <span ref={ref} className={className}>
      {initial}
    </span>
  );
}

/** Press feedback for interactive elements (used as a wrapper, keeps semantics). */
export function Press({ children, className }: { children: ReactNode; className?: string }) {
  const staticEntry = useStaticEntrance();
  if (staticEntry) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.01 }}>
      {children}
    </motion.div>
  );
}
