import { useEffect, useRef, useCallback, useMemo } from 'react';
import { gsap } from 'gsap';

/**
 * TargetCursor — a spinning crosshair that replaces the pointer and snaps its
 * four brackets around any `.cursor-target` element (adapted from React Bits to
 * TS). Used on the public brand surfaces only; the console keeps the real
 * cursor, because hiding it would wreck text selection and precision work.
 *
 * Returns null (and leaves the system cursor alone) on touch devices and for
 * anyone who prefers reduced motion.
 */

/**
 * A `position: fixed` element is viewport-relative UNLESS an ancestor creates a
 * containing block (transform / perspective / filter / will-change / contain).
 * The hero does exactly that (its Ken-Burns zoom is a transform), so we find
 * that ancestor and subtract its offset — otherwise the cursor drifts.
 */
const getContainingBlock = (element: HTMLElement | null): HTMLElement | null => {
  let node = element?.parentElement ?? null;
  while (node && node !== document.documentElement) {
    const s = getComputedStyle(node);
    if (
      s.transform !== 'none' ||
      s.perspective !== 'none' ||
      s.filter !== 'none' ||
      s.willChange.includes('transform') ||
      s.willChange.includes('perspective') ||
      s.willChange.includes('filter') ||
      /paint|layout|strict|content/.test(s.contain)
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

const getContainingBlockOffset = (block: HTMLElement | null): { x: number; y: number } => {
  if (!block) return { x: 0, y: 0 };
  const rect = block.getBoundingClientRect();
  return { x: rect.left + block.clientLeft, y: rect.top + block.clientTop };
};

export interface TargetCursorProps {
  targetSelector?: string;
  spinDuration?: number;
  hideDefaultCursor?: boolean;
  hoverDuration?: number;
  parallaxOn?: boolean;
  cursorColor?: string;
  cursorColorOnTarget?: string;
}

const BORDER_WIDTH = 3;
const CORNER_SIZE = 12;

export function TargetCursor({
  targetSelector = '.cursor-target',
  spinDuration = 2,
  hideDefaultCursor = true,
  hoverDuration = 0.2,
  parallaxOn = true,
  cursorColor = '#ffffff',
  cursorColorOnTarget,
}: TargetCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const cornersRef = useRef<NodeListOf<HTMLElement> | null>(null);
  const spinTl = useRef<gsap.core.Timeline | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const containingBlockRef = useRef<HTMLElement | null>(null);
  const targetCornersRef = useRef<{ x: number; y: number }[] | null>(null);
  const tickerFnRef = useRef<(() => void) | null>(null);
  const strengthRef = useRef({ current: 0 });

  // Touch devices have no hover, and a hidden system cursor there is a trap.
  const disabled = useMemo(() => {
    if (typeof window === 'undefined') return true;
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const small = window.innerWidth <= 768;
    const ua = (navigator.userAgent || '').toLowerCase();
    const mobileUa = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return (touch && small) || mobileUa || reduced;
  }, []);

  const moveCursor = useCallback((x: number, y: number) => {
    if (!cursorRef.current) return;
    const { x: ox, y: oy } = getContainingBlockOffset(containingBlockRef.current);
    gsap.to(cursorRef.current, { x: x - ox, y: y - oy, duration: 0.1, ease: 'power3.out' });
  }, []);

  useEffect(() => {
    if (disabled || !cursorRef.current) return;

    const cursor = cursorRef.current;
    const originalCursor = document.body.style.cursor;
    if (hideDefaultCursor) document.body.style.cursor = 'none';

    cornersRef.current = cursor.querySelectorAll<HTMLElement>('.target-cursor-corner');
    containingBlockRef.current = getContainingBlock(cursor);
    const getOffset = (): { x: number; y: number } =>
      getContainingBlockOffset(containingBlockRef.current);

    let activeTarget: HTMLElement | null = null;
    let currentLeaveHandler: (() => void) | null = null;
    let resumeTimeout: number | null = null;

    const initial = getOffset();
    gsap.set(cursor, {
      xPercent: -50,
      yPercent: -50,
      x: window.innerWidth / 2 - initial.x,
      y: window.innerHeight / 2 - initial.y,
    });

    const spin = (): void => {
      spinTl.current?.kill();
      spinTl.current = gsap
        .timeline({ repeat: -1 })
        .to(cursor, { rotation: '+=360', duration: spinDuration, ease: 'none' });
    };
    spin();

    // Per-frame easing of the brackets toward the target's corners.
    const tickerFn = (): void => {
      const targets = targetCornersRef.current;
      if (!targets || !cornersRef.current) return;
      const strength = strengthRef.current.current;
      if (strength === 0) return;

      const cx = gsap.getProperty(cursor, 'x') as number;
      const cy = gsap.getProperty(cursor, 'y') as number;

      Array.from(cornersRef.current).forEach((corner, i) => {
        const curX = gsap.getProperty(corner, 'x') as number;
        const curY = gsap.getProperty(corner, 'y') as number;
        const tx = targets[i].x - cx;
        const ty = targets[i].y - cy;
        const duration = strength >= 0.99 ? (parallaxOn ? 0.2 : 0) : 0.05;
        gsap.to(corner, {
          x: curX + (tx - curX) * strength,
          y: curY + (ty - curY) * strength,
          duration,
          ease: duration === 0 ? 'none' : 'power1.out',
          overwrite: 'auto',
        });
      });
    };
    tickerFnRef.current = tickerFn;

    const moveHandler = (e: MouseEvent): void => moveCursor(e.clientX, e.clientY);
    window.addEventListener('mousemove', moveHandler);

    const mouseDown = (): void => {
      if (dotRef.current) gsap.to(dotRef.current, { scale: 0.7, duration: 0.3 });
      gsap.to(cursor, { scale: 0.9, duration: 0.2 });
    };
    const mouseUp = (): void => {
      if (dotRef.current) gsap.to(dotRef.current, { scale: 1, duration: 0.3 });
      gsap.to(cursor, { scale: 1, duration: 0.2 });
    };
    window.addEventListener('mousedown', mouseDown);
    window.addEventListener('mouseup', mouseUp);

    const enterHandler = (e: MouseEvent): void => {
      let node = e.target instanceof HTMLElement ? e.target : null;
      let target: HTMLElement | null = null;
      while (node && node !== document.body) {
        if (node.matches(targetSelector)) {
          target = node;
          break;
        }
        node = node.parentElement;
      }
      if (!target || !cornersRef.current || activeTarget === target) return;

      if (activeTarget && currentLeaveHandler) {
        activeTarget.removeEventListener('mouseleave', currentLeaveHandler);
      }
      if (resumeTimeout) {
        clearTimeout(resumeTimeout);
        resumeTimeout = null;
      }

      activeTarget = target;
      const corners = Array.from(cornersRef.current);
      corners.forEach((c) => gsap.killTweensOf(c, 'x,y'));
      gsap.killTweensOf(cursor, 'rotation');
      spinTl.current?.pause();
      gsap.set(cursor, { rotation: 0 });

      if (cursorColorOnTarget) {
        gsap.to(corners, { borderColor: cursorColorOnTarget, duration: 0.15, ease: 'power2.out' });
        if (dotRef.current) {
          gsap.to(dotRef.current, {
            backgroundColor: cursorColorOnTarget,
            duration: 0.15,
            ease: 'power2.out',
          });
        }
      }

      const rect = target.getBoundingClientRect();
      const { x: ox, y: oy } = getOffset();
      const cx = gsap.getProperty(cursor, 'x') as number;
      const cy = gsap.getProperty(cursor, 'y') as number;

      targetCornersRef.current = [
        { x: rect.left - BORDER_WIDTH - ox, y: rect.top - BORDER_WIDTH - oy },
        { x: rect.right + BORDER_WIDTH - CORNER_SIZE - ox, y: rect.top - BORDER_WIDTH - oy },
        {
          x: rect.right + BORDER_WIDTH - CORNER_SIZE - ox,
          y: rect.bottom + BORDER_WIDTH - CORNER_SIZE - oy,
        },
        { x: rect.left - BORDER_WIDTH - ox, y: rect.bottom + BORDER_WIDTH - CORNER_SIZE - oy },
      ];

      gsap.ticker.add(tickerFn);
      gsap.to(strengthRef.current, { current: 1, duration: hoverDuration, ease: 'power2.out' });

      corners.forEach((corner, i) => {
        const t = targetCornersRef.current as { x: number; y: number }[];
        gsap.to(corner, { x: t[i].x - cx, y: t[i].y - cy, duration: 0.2, ease: 'power2.out' });
      });

      const leaveHandler = (): void => {
        gsap.ticker.remove(tickerFn);
        targetCornersRef.current = null;
        gsap.set(strengthRef.current, { current: 0, overwrite: true });
        activeTarget = null;

        if (cursorColorOnTarget && cornersRef.current) {
          gsap.to(Array.from(cornersRef.current), {
            borderColor: cursorColor,
            duration: 0.15,
            ease: 'power2.out',
          });
          if (dotRef.current) {
            gsap.to(dotRef.current, {
              backgroundColor: cursorColor,
              duration: 0.15,
              ease: 'power2.out',
            });
          }
        }

        if (cornersRef.current) {
          const cs = Array.from(cornersRef.current);
          gsap.killTweensOf(cs, 'x,y');
          const rest = [
            { x: -CORNER_SIZE * 1.5, y: -CORNER_SIZE * 1.5 },
            { x: CORNER_SIZE * 0.5, y: -CORNER_SIZE * 1.5 },
            { x: CORNER_SIZE * 0.5, y: CORNER_SIZE * 0.5 },
            { x: -CORNER_SIZE * 1.5, y: CORNER_SIZE * 0.5 },
          ];
          const tl = gsap.timeline();
          cs.forEach((corner, i) => {
            tl.to(corner, { x: rest[i].x, y: rest[i].y, duration: 0.3, ease: 'power3.out' }, 0);
          });
        }

        resumeTimeout = window.setTimeout(() => {
          if (!activeTarget) spin();
          resumeTimeout = null;
        }, 50);

        if (target && currentLeaveHandler) {
          target.removeEventListener('mouseleave', currentLeaveHandler);
        }
        currentLeaveHandler = null;
      };

      currentLeaveHandler = leaveHandler;
      target.addEventListener('mouseleave', leaveHandler);
    };

    window.addEventListener('mouseover', enterHandler, { passive: true });

    const resizeHandler = (): void => {
      containingBlockRef.current = getContainingBlock(cursor);
    };
    window.addEventListener('resize', resizeHandler);

    return () => {
      if (tickerFnRef.current) gsap.ticker.remove(tickerFnRef.current);
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseover', enterHandler);
      window.removeEventListener('resize', resizeHandler);
      window.removeEventListener('mousedown', mouseDown);
      window.removeEventListener('mouseup', mouseUp);
      if (activeTarget && currentLeaveHandler) {
        activeTarget.removeEventListener('mouseleave', currentLeaveHandler);
      }
      if (resumeTimeout) clearTimeout(resumeTimeout);
      spinTl.current?.kill();
      // Always give the real cursor back, whatever state we were in.
      document.body.style.cursor = originalCursor;
      targetCornersRef.current = null;
      strengthRef.current.current = 0;
    };
  }, [
    targetSelector,
    spinDuration,
    moveCursor,
    hideDefaultCursor,
    disabled,
    hoverDuration,
    parallaxOn,
    cursorColor,
    cursorColorOnTarget,
  ]);

  if (disabled) return null;

  return (
    <div ref={cursorRef} className="target-cursor-wrapper" aria-hidden="true">
      <div ref={dotRef} className="target-cursor-dot" style={{ backgroundColor: cursorColor }} />
      <div className="target-cursor-corner corner-tl" style={{ borderColor: cursorColor }} />
      <div className="target-cursor-corner corner-tr" style={{ borderColor: cursorColor }} />
      <div className="target-cursor-corner corner-br" style={{ borderColor: cursorColor }} />
      <div className="target-cursor-corner corner-bl" style={{ borderColor: cursorColor }} />
    </div>
  );
}

export default TargetCursor;
