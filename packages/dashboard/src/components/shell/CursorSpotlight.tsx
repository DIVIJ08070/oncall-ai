import { useEffect } from 'react';

/**
 * Ambient cursor spotlight for the console — the landing hero's "light reveals
 * what's underneath" idea, carried into every app page.
 *
 * Writes the pointer position to `--mx` / `--my` on the document root; the
 * `.spot-ambient` layer (and anything else that wants it) renders off those
 * variables in pure CSS. Style writes happen straight in the listener rather
 * than in a rAF callback, so the effect keeps working in backgrounded
 * documents where rAF is throttled to a standstill.
 */
export function CursorSpotlight() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const root = document.documentElement;
    const onMove = (e: MouseEvent): void => {
      root.style.setProperty('--mx', `${e.clientX}px`);
      root.style.setProperty('--my', `${e.clientY}px`);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      root.style.removeProperty('--mx');
      root.style.removeProperty('--my');
    };
  }, []);

  return <div className="spot-ambient" aria-hidden="true" />;
}
