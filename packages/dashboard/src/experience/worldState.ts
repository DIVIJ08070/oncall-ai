/**
 * THE NIGHT SHIFT — world-state architecture (the "secret sauce").
 *
 * One scroll position drives ONE world state; every layer (canvas, typography,
 * chrome, acts) reads from it. Scroll is not navigation — scroll is time.
 *
 * The engine writes plain CSS custom properties + data attributes from a
 * passive scroll listener (never rAF), so choreography works even where
 * animation frames are frozen (hidden documents), and stays cheap.
 */

export interface ActSpec {
  id: string;
  /** Instrument-panel name, uppercase. */
  name: string;
  /** Scroll length of the act, in viewport-heights. */
  vh: number;
}

export const ACTS: ActSpec[] = [
  { id: 'hero', name: 'THE NIGHT SHIFT', vh: 240 },
  { id: 'break', name: 'SOMETHING BREAKS', vh: 220 },
  { id: 'engine', name: 'THE INCIDENT ENGINE', vh: 340 },
  { id: 'pipeline', name: 'SIGNAL TO RECOVERY', vh: 280 },
  { id: 'data', name: 'THE DATA', vh: 220 },
  { id: 'movie', name: 'A REAL NIGHT, REPLAYED', vh: 280 },
  { id: 'buddy', name: 'THE DAY SHIFT', vh: 240 },
  { id: 'proof', name: 'REAL REVIEWS', vh: 220 },
  { id: 'finale', name: 'SLEEP. WE WATCH.', vh: 170 },
];

export interface WorldState {
  /** 0..1 across the whole experience. */
  wp: number;
  /** Index of the current act. */
  act: number;
  /** 0..1 within the current act. */
  ap: number;
  /** Viewport size. */
  vw: number;
  vh: number;
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Piecewise scroll→world mapping over the acts' cumulative pixel heights. */
export function computeWorld(scrollY: number, vw: number, vh: number): WorldState {
  const px = ACTS.map((a) => (a.vh / 100) * vh);
  const total = px.reduce((a, b) => a + b, 0) - vh; // last screen isn't scrolled past
  const wp = clamp01(total > 0 ? scrollY / total : 0);

  let acc = 0;
  for (let i = 0; i < ACTS.length; i++) {
    const extent = px[i] - (i === ACTS.length - 1 ? vh : 0);
    if (scrollY < acc + extent || i === ACTS.length - 1) {
      // Normalize over the PINNED span (section height minus one viewport):
      // the sticky frame releases after that, so ap must reach 1 while the
      // act is still fully on screen. The final viewport of each section
      // holds the completed state as the frame slides away.
      const pinned = Math.max(px[i] - vh, 1);
      const ap = clamp01((scrollY - acc) / pinned);
      return { wp, act: i, ap, vw, vh };
    }
    acc += extent;
  }
  return { wp, act: ACTS.length - 1, ap: 1, vw, vh };
}

/** Local progress of act `i` given the absolute scroll — for neighbours' overlap. */
export function actProgress(world: WorldState, i: number): number {
  if (world.act === i) return world.ap;
  return world.act > i ? 1 : 0;
}
