import { useEffect, useRef } from 'react';
import type { WorldState } from './worldState';
import { clamp01 } from './worldState';

/**
 * The world's visual engine: a fixed full-screen 2D canvas behind the DOM acts.
 * It draws (per scroll event, plus a gentle ambient tick when visible):
 *  - a seeded particle field (logs drifting in the dark) with scroll parallax,
 *  - THE ORANGE DIAMOND — the AI responder — whose position/scale/rotation are
 *    keyframed across the acts (it approaches, wakes, travels the timeline,
 *    splits into a day-shift twin, and finally rests),
 *  - act-specific effects: the detection stream (act 2), the data explosion
 *    that reassembles into an error-rate graph (act 4).
 *
 * Everything is a PURE function of (world, t): rendering once at any scroll
 * position yields the correct frame — no accumulated simulation state.
 */

const ORANGE = '#F16524';
const ORANGE_2 = '#FF8233';

interface P {
  x: number; // 0..1 base position
  y: number;
  z: number; // depth 0.2..1 (parallax + size)
  tw: number; // twinkle phase
}

function seeded(n: number): () => number {
  let s = n >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const rand = seeded(20260820);
const FIELD: P[] = Array.from({ length: 170 }, () => ({
  x: rand(),
  y: rand(),
  z: 0.2 + rand() * 0.8,
  tw: rand() * Math.PI * 2,
}));

/** Diamond pose keyframes per act (x,y in viewport fractions). */
function diamondPose(w: WorldState): {
  x: number; y: number; s: number; rot: number; glow: number; split: number;
} {
  const { act, ap } = w;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const ease = (t: number) => t * t * (3 - 2 * t);
  switch (act) {
    case 0: // hero: impossibly far → approaching, slow rotation
      return { x: 0.5, y: 0.42, s: lerp(0.05, 0.42, ease(ap)), rot: ap * 1.2, glow: lerp(0.15, 0.5, ap), split: 0 };
    case 1: // the break: small, enters from the right as fragments converge
      return { x: lerp(1.08, 0.5, ease(clamp01(ap * 1.6 - 0.45))), y: 0.55, s: 0.16, rot: 0.4 + ap * 0.5, glow: clamp01(ap * 1.4 - 0.3), split: 0 };
    case 2: // incident engine: travels left→right along the timeline
      return { x: lerp(0.12, 0.88, ease(ap)), y: 0.6, s: 0.14, rot: ap * 2.2, glow: 0.85, split: 0 };
    case 3: // pipeline: rides above the stations
      return { x: lerp(0.1, 0.9, ap), y: 0.24, s: 0.1, rot: ap * 1.4, glow: 0.7, split: 0 };
    case 4: // data: centered, pulsing with the spike
      return { x: 0.5, y: 0.3, s: 0.12, rot: 0.2, glow: ap > 0.45 && ap < 0.75 ? 1 : 0.55, split: 0 };
    case 5: // movie: patrols slowly
      return { x: lerp(0.15, 0.85, ap), y: 0.14, s: 0.08, rot: ap, glow: 0.5, split: 0 };
    case 6: // buddy: SPLITS into two
      return { x: 0.5, y: 0.3, s: 0.13, rot: 0.6, glow: 0.8, split: ease(clamp01(ap * 2)) };
    case 7: // proof: constellation nucleus
      return { x: 0.5, y: 0.5, s: 0.16, rot: 0.8 + ap * 0.6, glow: 0.75, split: 0 };
    default: // finale: small, calm, center
      return { x: 0.5, y: 0.44, s: lerp(0.16, 0.09, ease(ap)), rot: 1.4, glow: lerp(0.7, 0.35, ap), split: 0 };
  }
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rot: number,
  glow: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  if (glow > 0.02) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 5);
    g.addColorStop(0, `rgba(241,101,36,${0.34 * glow})`);
    g.addColorStop(1, 'rgba(241,101,36,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-r * 5, -r * 5, r * 10, r * 10);
  }
  // the mark: two stacked half-diamonds (the logo geometry, abstracted)
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.78, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.78, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = ORANGE_2;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.45);
  ctx.lineTo(r * 0.35, 0);
  ctx.lineTo(0, r * 0.45);
  ctx.lineTo(-r * 0.35, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}


/**
 * Diamond Core state layer (brief §8): the same object visibly evolves —
 * detecting = expanding pulse rings, investigating = orbital structure,
 * fixing = directional streams, verifying = stable rings, recovered = calm
 * breathing ring. Driven by (act, ap) plus ambient time so it still reads
 * when rAF is frozen (scroll advances the phase).
 */
function drawStateLayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  w: WorldState,
  t: number,
): void {
  const ph = t * 0.9 + w.ap * 7; // scroll-advanced phase
  const ring = (rad: number, alpha: number, width = 1): void => {
    if (alpha <= 0.01 || rad <= 0) return;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(241,101,36,${alpha})`;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  switch (w.act) {
    case 1: {
      // DETECTING — pulse rings expand outward and dissolve
      for (let k = 0; k < 3; k++) {
        const u = (ph * 0.4 + k / 3) % 1;
        ring(r * (1 + u * 2.6), 0.34 * (1 - u) * clamp01(w.ap * 2 - 0.5));
      }
      break;
    }
    case 2: {
      // INVESTIGATING — rotating elliptical orbits; FIXING — directional streams
      const orbit = clamp01(1.6 - w.ap * 2.4); // fades as FIX approaches
      if (orbit > 0.02) {
        for (let k = 0; k < 2; k++) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(ph * (k ? -0.5 : 0.35) + k * 1.2);
          ctx.scale(1, 0.38);
          ctx.beginPath();
          ctx.arc(0, 0, r * (1.7 + k * 0.5), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,130,51,${0.3 * orbit})`;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        }
      }
      const streams = clamp01(w.ap * 3 - 1.4) * clamp01(3 - w.ap * 3.4);
      if (streams > 0.02) {
        for (let k = 0; k < 7; k++) {
          const u = ((ph * 0.7 + k / 7) % 1);
          const sx = x - r * (3.4 - u * 2.6);
          const sy = y + Math.sin(k * 2.1) * r * 0.9;
          ctx.strokeStyle = `rgba(241,101,36,${0.4 * streams * u})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + r * 0.8, sy + (y - sy) * 0.2);
          ctx.stroke();
        }
      }
      break;
    }
    case 4: {
      // RESPONDING to the spike — urgent tight pulses inside the spike window
      if (w.ap > 0.45 && w.ap < 0.78) {
        const u = (ph * 0.9) % 1;
        ring(r * (1 + u * 1.6), 0.4 * (1 - u));
      }
      break;
    }
    case 5: {
      // VERIFYING — stable concentric rings, no motion urgency
      ring(r * 1.9, 0.2);
      ring(r * 2.6, 0.11);
      break;
    }
    case 7: {
      // holding the constellation — one slow orbital
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ph * 0.18);
      ctx.scale(1, 0.42);
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,130,51,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 8: {
      // RECOVERED — a single calm breathing ring
      ring(r * (2 + Math.sin(ph) * 0.15), 0.16);
      break;
    }
  }
}

export class WorldEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private world: WorldState | null = null;
  private raf = 0;
  private t0 = 0;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  resize(): void {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.world) this.render(this.world);
  }

  setWorld(world: WorldState): void {
    this.world = world;
    this.render(world);
  }

  /** Ambient twinkle only — cheap, and skipped entirely when hidden. */
  startAmbient(): void {
    if (typeof document === 'undefined' || document.visibilityState === 'hidden') return;
    const tick = (t: number): void => {
      if (!this.t0) this.t0 = t;
      if (this.world) this.render(this.world, (t - this.t0) / 1000);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  render(w: WorldState, t = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { vw, vh } = w;
    ctx.clearRect(0, 0, vw, vh);

    // layered darkness
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, vw, vh);

    // particle field: telemetry drifting in the dark
    const drift = w.wp * 2.2;
    for (const p of FIELD) {
      const y = ((p.y + drift * p.z) % 1 + 1) % 1;
      const a = 0.05 + 0.1 * p.z + 0.05 * Math.sin(t * 0.8 + p.tw);
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0.02, a)})`;
      const size = p.z * 1.6;
      ctx.fillRect(p.x * vw, y * vh, size, size);
    }

    // act 2 — detection stream: particles converge toward the diamond
    if (w.act === 2 && w.ap < 0.4) {
      const k = clamp01(w.ap / 0.4);
      const pose0 = diamondPose(w);
      for (let i = 0; i < 60; i++) {
        const r = seeded(i * 7919);
        const sx = r() * vw;
        const sy = r() * vh;
        const x = sx + (pose0.x * vw - sx) * (k * (0.5 + r() * 0.5));
        const y = sy + (pose0.y * vh - sy) * (k * (0.5 + r() * 0.5));
        const hot = i === 17; // one log line turns orange — the detection
        ctx.fillStyle = hot && k > 0.5 ? ORANGE : `rgba(255,255,255,${0.12 + 0.2 * k})`;
        ctx.fillRect(x, y, hot ? 3 : 1.6, hot ? 3 : 1.6);
      }
    }

    // act 4 — the data explosion → graph
    if (w.act === 4) {
      const N = 90;
      const explode = clamp01((w.ap - 0.12) / 0.28); // 0..1 explode
      const reform = clamp01((w.ap - 0.45) / 0.3); // 0..1 into the graph
      for (let i = 0; i < N; i++) {
        const r = seeded(i * 104729);
        // grid position (as characters)
        const gx = 0.2 + (i % 15) * 0.04;
        const gy = 0.3 + Math.floor(i / 15) * 0.055;
        // exploded position
        const ang = r() * Math.PI * 2;
        const rad = 0.15 + r() * 0.4;
        const ex = 0.5 + Math.cos(ang) * rad;
        const ey = 0.45 + Math.sin(ang) * rad * 0.7;
        // graph position: an error-rate curve with a spike that recovers
        const gxx = 0.14 + (i / N) * 0.72;
        const spike = Math.exp(-Math.pow((i / N - 0.55) * 9, 2));
        const recover = clamp01((w.ap - 0.8) / 0.2);
        const gyy = 0.62 - spike * 0.22 * (1 - recover) - 0.02 * Math.sin(i);
        let x = gx + (ex - gx) * explode;
        let y = gy + (ey - gy) * explode;
        x = x + (gxx - x) * reform;
        y = y + (gyy - y) * reform;
        const isErr = i % 4 !== 3;
        const onSpike = reform > 0.9 && spike > 0.5 && recover < 0.6;
        ctx.fillStyle = onSpike ? ORANGE : isErr ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.22)';
        ctx.fillRect(x * vw, y * vh, 2.4, 2.4);
      }
    }

    // THE DIAMOND (and its day-shift twin in act 6)
    const pose = diamondPose(w);
    const base = Math.min(vw, vh);
    const r = pose.s * base * 0.5;
    if (pose.split > 0.01) {
      const off = pose.split * vw * 0.22;
      drawDiamond(ctx, pose.x * vw - off, pose.y * vh, r * (1 - pose.split * 0.15), pose.rot, pose.glow);
      drawDiamond(ctx, pose.x * vw + off, pose.y * vh, r * (1 - pose.split * 0.15), -pose.rot, pose.glow);
      drawStateLayer(ctx, pose.x * vw - off, pose.y * vh, r, w, t);
      drawStateLayer(ctx, pose.x * vw + off, pose.y * vh, r, w, t);
    } else {
      drawDiamond(ctx, pose.x * vw, pose.y * vh, r, pose.rot, pose.glow);
      drawStateLayer(ctx, pose.x * vw, pose.y * vh, r, w, t);
    }
  }
}

export function WorldCanvas({ engine }: { engine: WorldEngine }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    engine.attach(canvas);
    const onResize = (): void => engine.resize();
    window.addEventListener('resize', onResize);
    engine.startAmbient();
    return () => {
      window.removeEventListener('resize', onResize);
      engine.stop();
    };
  }, [engine]);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
