/**
 * CRITICAL ANIMATION RULE (see feature brief): entrance/reveal animations must
 * render content visible immediately when the document is hidden (embedded
 * previews freeze requestAnimationFrame, so framer-motion entrances would
 * leave the page blank) or when the user prefers reduced motion.
 *
 * Entrance components call this at render time and skip framer-motion
 * entirely when it returns true. Hover/loop effects may keep framer but
 * should still respect reduced motion.
 */
export function prefersStaticEntrance(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return true;
  if (document.visibilityState === 'hidden') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
