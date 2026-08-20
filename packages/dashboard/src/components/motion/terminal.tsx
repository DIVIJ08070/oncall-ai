import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Terminal-theme text primitives: typewriter reveals and the blinking phosphor
 * cursor. Same safety contract as the rest of the motion system — if the user
 * prefers reduced motion or the document mounts hidden, text renders complete
 * and static immediately (never blank, never stuck mid-type).
 */

function useStaticMode(): boolean {
  const [staticMode] = useState(
    () =>
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ||
      (typeof document !== 'undefined' && document.visibilityState === 'hidden'),
  );
  return staticMode;
}

/** Blinking phosphor block cursor. */
export function Cursor({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden className={`crt-cursor ${className}`} />
  );
}

/** Types `text` character-by-character. `cursor` keeps the block blinking after. */
export function TypeText({
  text,
  speed = 28,
  delay = 0,
  cursor = false,
  className = '',
  onDone,
}: {
  text: string;
  speed?: number;
  delay?: number;
  cursor?: boolean;
  className?: string;
  onDone?: () => void;
}) {
  const staticMode = useStaticMode();
  const [n, setN] = useState(staticMode ? text.length : 0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (staticMode) return;
    let i = 0;
    let interval: number | undefined;
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length && interval) window.clearInterval(interval);
      }, speed);
    }, delay);
    return () => {
      window.clearTimeout(start);
      if (interval) window.clearInterval(interval);
    };
  }, [text, speed, delay, staticMode]);

  useEffect(() => {
    if (n >= text.length && !doneRef.current) {
      doneRef.current = true;
      onDone?.();
    }
  }, [n, text.length, onDone]);

  return (
    <span className={className} aria-label={text}>
      <span aria-hidden>{text.slice(0, n)}</span>
      {cursor && <Cursor />}
    </span>
  );
}

/**
 * A boot sequence: lines appear one after another (each fades in whole — the
 * per-character effect is reserved for TypeText so long logs stay quick).
 */
export function BootLines({
  lines,
  interval = 260,
  delay = 0,
  className = '',
  lineClassName = '',
  onDone,
}: {
  lines: ReactNode[];
  interval?: number;
  delay?: number;
  className?: string;
  lineClassName?: string;
  onDone?: () => void;
}) {
  const staticMode = useStaticMode();
  const [shown, setShown] = useState(staticMode ? lines.length : 0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (staticMode) return;
    let i = 0;
    let iv: number | undefined;
    const start = window.setTimeout(() => {
      iv = window.setInterval(() => {
        i += 1;
        setShown(i);
        if (i >= lines.length && iv) window.clearInterval(iv);
      }, interval);
    }, delay);
    return () => {
      window.clearTimeout(start);
      if (iv) window.clearInterval(iv);
    };
  }, [lines.length, interval, delay, staticMode]);

  useEffect(() => {
    if (shown >= lines.length && !doneRef.current) {
      doneRef.current = true;
      onDone?.();
    }
  }, [shown, lines.length, onDone]);

  return (
    <div className={className}>
      {lines.slice(0, shown).map((l, i) => (
        <div key={i} className={lineClassName}>
          {l}
        </div>
      ))}
    </div>
  );
}
