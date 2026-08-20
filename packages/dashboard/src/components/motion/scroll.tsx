import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  motion,
  useInView,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';

/**
 * Scroll-driven motion primitives (motion/react) for the premium landing pages.
 *
 * Every primitive obeys the same safety contract that saved us before: when the
 * user prefers reduced motion, OR the document is hidden (embedded previews
 * freeze rAF and never fire IntersectionObserver), the content renders in its
 * FINAL, visible state — it is never left blank waiting for a trigger that will
 * not come. Decorative-only transforms (parallax) simply no-op in that case.
 */

/**
 * Frozen at MOUNT: if the user prefers reduced motion, or the document is hidden
 * when the component first renders (embedded previews freeze rAF and never fire
 * IntersectionObserver), we commit to the static/visible branch for this
 * component's whole life. Freezing prevents a hidden→visible re-render from
 * flipping a component from "static & visible" into "motion & opacity:0" with a
 * trigger that has already passed — which would leave content permanently blank.
 */
function useFrozenStatic(): boolean {
  const [staticMode] = useState(
    () =>
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ||
      (typeof document !== 'undefined' && document.visibilityState === 'hidden'),
  );
  return staticMode;
}

/**
 * Whether a scroll-reveal target should be shown. Robust against environments
 * where IntersectionObserver is unreliable:
 *  - if the element is ALREADY in the viewport at mount (e.g. the hero), show it
 *    immediately — above-the-fold content must never wait for a scroll trigger;
 *  - otherwise reveal when it scrolls into view (the intended effect);
 *  - as a last-resort safety net, reveal after 3s so a section can never stay
 *    permanently blank if the observer never fires.
 */
function useRevealed(ref: React.RefObject<HTMLElement | null>, once = true): boolean {
  const inView = useInView(ref, { once, margin: '0px 0px -12% 0px' });
  const [forced, setForced] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      setForced(true);
      return;
    }
    const r = el.getBoundingClientRect();
    const inInitialViewport = r.top < (window.innerHeight || 0) && r.bottom > 0;
    if (inInitialViewport) {
      setForced(true);
      return;
    }
    const t = window.setTimeout(() => setForced(true), 3000);
    return () => window.clearTimeout(t);
  }, [ref]);
  return inView || forced;
}

const EASE = [0.16, 1, 0.3, 1] as const;

/** Fade + rise (+ optional blur) as the element scrolls into view. */
export function ScrollReveal({
  children,
  className,
  y = 32,
  blur = false,
  delay = 0,
  once = true,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
  blur?: boolean;
  delay?: number;
  once?: boolean;
}) {
  const staticMode = useFrozenStatic();
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRevealed(ref, once);
  if (staticMode) return <div className={className}>{children}</div>;
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y, filter: blur ? 'blur(10px)' : 'blur(0px)' }}
      animate={shown ? { opacity: 1, y: 0, filter: 'blur(0px)' } : undefined}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Container whose <ScrollStaggerItem> children rise in sequence on entry. */
export function ScrollStagger({
  children,
  className,
  each = 0.09,
  once = true,
}: {
  children: ReactNode;
  className?: string;
  each?: number;
  once?: boolean;
}) {
  const staticMode = useFrozenStatic();
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRevealed(ref, once);
  if (staticMode) return <div className={className}>{children}</div>;
  return (
    <motion.div
      ref={ref}
      className={className}
      initial="hidden"
      animate={shown ? 'show' : 'hidden'}
      variants={{ hidden: {}, show: { transition: { staggerChildren: each } } }}
    >
      {children}
    </motion.div>
  );
}

export function ScrollStaggerItem({
  children,
  className,
  y = 28,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
}) {
  const staticMode = useFrozenStatic();
  if (staticMode) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y, scale: 0.96 },
        show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Headline that assembles word-by-word as it enters view — the "every scroll
 * feels alive" centerpiece. Splits on spaces; each word rises + unblurs.
 */
export function ScrollWords({
  text,
  className,
  wordClassName,
}: {
  text: string;
  className?: string;
  wordClassName?: string;
}) {
  const staticMode = useFrozenStatic();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRevealed(ref, true);
  const words = text.split(' ');
  if (staticMode) return <span className={className}>{text}</span>;
  return (
    <span ref={ref} className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="inline-block overflow-hidden align-bottom" aria-hidden>
          <motion.span
            // `className` (often a bg-clip-text gradient) must be applied PER-WORD:
            // background-clip:text on the outer wrapper does not clip through nested
            // word spans, so the gradient headline would render invisible otherwise.
            className={`inline-block ${className ?? ''} ${wordClassName ?? ''}`}
            initial={{ y: '110%', opacity: 0, filter: 'blur(8px)' }}
            animate={shown ? { y: '0%', opacity: 1, filter: 'blur(0px)' } : undefined}
            transition={{ duration: 0.7, delay: i * 0.07, ease: EASE }}
          >
            {w}
          </motion.span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

/**
 * Decorative parallax: shifts a layer as the section scrolls through the
 * viewport. Apply to background/glow layers only — never body text.
 */
export function Parallax({
  children,
  className,
  speed = 0.2,
}: {
  children: ReactNode;
  className?: string;
  speed?: number;
}) {
  const staticMode = useFrozenStatic();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const raw = useTransform(scrollYProgress, [0, 1], [`${speed * 100}%`, `${-speed * 100}%`]);
  const y = useSpring(raw, { stiffness: 90, damping: 30, mass: 0.4 });
  if (staticMode) return <div className={className}>{children}</div>;
  return (
    <motion.div ref={ref} className={className} style={{ y }}>
      {children}
    </motion.div>
  );
}

/** Whole-page scroll progress bar (thin accent line pinned to the top). */
export function ScrollProgress({ color = 'var(--accent, #F16524)' }: { color?: string }) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });
  return (
    <motion.div
      aria-hidden
      className="fixed left-0 right-0 top-0 z-[200] h-[3px] origin-left"
      style={{ scaleX, backgroundColor: color }}
    />
  );
}
