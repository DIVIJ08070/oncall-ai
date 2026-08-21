import { useEffect, useMemo, useRef } from 'react';
import type { Learning } from '../../../api/learnings';

/**
 * KnowledgeMap — a 2D canvas constellation of what the AI knows about a repo.
 * Learnings cluster by errorClass: each class is a hub star (palette rotates
 * orange → green → violet → silver) with its learnings as tiny satellite dots
 * wired to the hub by thin lines. Layout is deterministic (seeded by the class
 * names) so the map is stable across renders; the whole field drifts and
 * twinkles gently via one rAF loop that pauses while the document is hidden
 * and goes fully static under prefers-reduced-motion. Hovering a hub
 * highlights its cluster and draws a canvas tooltip ("ERRORCLASS · N
 * learnings"). Zero React re-renders per frame — everything lives in refs.
 */

export interface KnowledgeMapProps {
  learnings: Learning[];
  className?: string;
}

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const MAX_SATS_PER_HUB = 26;
const HUB_DRIFT_PX = 5;
const SAT_DRIFT_PX = 1.7;

/** Palette rotation for hubs: orange / green / violet / silver. */
const HUB_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [241, 101, 36], // #F16524
  [82, 210, 115], // #52D273
  [139, 92, 246], // #8B5CF6
  [154, 160, 184], // #9aa0b8
];

/* ------------------------------------------------------------------ */
/* deterministic layout                                                */
/* ------------------------------------------------------------------ */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Tiny seeded PRNG so the constellation is stable across renders. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SatNode {
  angle: number;
  dist: number;
  r: number;
  twinklePhase: number;
  twinkleSpeed: number;
  driftPhase: number;
  driftSpeed: number;
}

interface HubNode {
  label: string;
  count: number;
  /** Constant color strings — no per-frame string churn. */
  col: string;
  glowIn: string;
  glowOut: string;
  nx: number;
  ny: number;
  r: number;
  driftPhase: number;
  driftSpeed: number;
  dim: boolean;
  sats: SatNode[];
  /** Screen position, refreshed every frame (scratch — avoids allocation). */
  sx: number;
  sy: number;
}

function makeSats(rng: () => number, count: number, hubR: number): SatNode[] {
  const sats: SatNode[] = [];
  for (let j = 0; j < count; j++) {
    sats.push({
      angle: j * GOLDEN + (rng() - 0.5) * 0.9,
      dist: hubR + 13 + Math.sqrt(j) * 10 + rng() * 6,
      r: 1.2 + rng() * 1.1,
      twinklePhase: rng() * TAU,
      twinkleSpeed: 0.6 + rng() * 1.4,
      driftPhase: rng() * TAU,
      driftSpeed: 0.3 + rng() * 0.5,
    });
  }
  return sats;
}

function makeHub(
  label: string,
  count: number,
  colorIndex: number,
  nx: number,
  ny: number,
  rng: () => number,
  dim: boolean,
): HubNode {
  const [r, g, b] = HUB_COLORS[colorIndex % HUB_COLORS.length];
  const hubR = dim ? 5 : 5 + 1.1 * Math.min(9, count);
  return {
    label,
    count,
    col: `rgb(${r},${g},${b})`,
    glowIn: `rgba(${r},${g},${b},0.32)`,
    glowOut: `rgba(${r},${g},${b},0)`,
    nx: Math.min(0.9, Math.max(0.1, nx)),
    ny: Math.min(0.84, Math.max(0.16, ny)),
    r: hubR,
    driftPhase: rng() * TAU,
    driftSpeed: 0.25 + rng() * 0.35,
    dim,
    sats: makeSats(rng, dim ? 4 : Math.min(MAX_SATS_PER_HUB, count), hubR),
    sx: 0,
    sy: 0,
  };
}

/** Group learnings into hubs and place them on a seeded phyllotaxis spiral. */
function buildModel(learnings: Learning[]): HubNode[] {
  if (learnings.length === 0) {
    // Empty state: three dim placeholder hubs waiting for the first signal.
    const rng = mulberry32(0x5eed);
    return [
      makeHub('', 0, 0, 0.27, 0.42, rng, true),
      makeHub('', 0, 3, 0.52, 0.64, rng, true),
      makeHub('', 0, 3, 0.75, 0.34, rng, true),
    ];
  }

  const groups = new Map<string, { label: string; count: number }>();
  for (const l of learnings) {
    const key = l.errorClass.toLowerCase();
    const found = groups.get(key);
    if (found) found.count += 1;
    else groups.set(key, { label: l.errorClass, count: 1 });
  }
  const clusters = [...groups.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );

  const seed = hashString(clusters.map((c) => c.label).join('|'));
  const rot = ((seed % 1000) / 1000) * TAU;
  const n = clusters.length;

  return clusters.map((c, i) => {
    const rng = mulberry32(hashString(c.label) ^ seed);
    const rr = n === 1 ? 0 : Math.sqrt((i + 0.5) / n);
    const ang = i * GOLDEN + rot;
    const nx = 0.5 + Math.cos(ang) * rr * 0.4 + (rng() - 0.5) * 0.07;
    const ny = 0.5 + Math.sin(ang) * rr * 0.34 + (rng() - 0.5) * 0.07;
    return makeHub(c.label, c.count, i, nx, ny, rng, false);
  });
}

/* ------------------------------------------------------------------ */
/* frame rendering (pure canvas — never touches React)                 */
/* ------------------------------------------------------------------ */

const MONO_FONT = '10px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  hubs: HubNode[],
  w: number,
  h: number,
  t: number,
  mouse: { x: number; y: number } | null,
): void {
  ctx.clearRect(0, 0, w, h);

  // Pass 1 — screen positions + hover hit-test.
  let hovered = -1;
  for (let i = 0; i < hubs.length; i++) {
    const hub = hubs[i];
    hub.sx = hub.nx * w + Math.sin(t * hub.driftSpeed + hub.driftPhase) * HUB_DRIFT_PX;
    hub.sy = hub.ny * h + Math.cos(t * hub.driftSpeed * 0.8 + hub.driftPhase) * HUB_DRIFT_PX;
    if (!hub.dim && mouse !== null && hovered === -1) {
      const dx = mouse.x - hub.sx;
      const dy = mouse.y - hub.sy;
      if (dx * dx + dy * dy <= (hub.r + 9) * (hub.r + 9)) hovered = i;
    }
  }

  // Pass 2 — clusters (lines, satellites, hub core + glow).
  for (let i = 0; i < hubs.length; i++) {
    const hub = hubs[i];
    const hot = hovered === i;
    // Hovering one cluster gently dims the others so it reads as "selected".
    const ca = (hub.dim ? 0.35 : 1) * (hovered !== -1 && !hot ? 0.35 : 1);

    ctx.strokeStyle = hub.col;
    ctx.fillStyle = hub.col;
    ctx.lineWidth = 1;
    for (const s of hub.sats) {
      const dx = Math.sin(t * s.driftSpeed + s.driftPhase) * SAT_DRIFT_PX;
      const dy = Math.cos(t * s.driftSpeed * 0.9 + s.driftPhase) * SAT_DRIFT_PX;
      const sx = hub.sx + Math.cos(s.angle) * s.dist + dx;
      const sy = hub.sy + Math.sin(s.angle) * s.dist * 0.85 + dy;

      ctx.globalAlpha = (hot ? 0.55 : 0.25) * ca;
      ctx.beginPath();
      ctx.moveTo(hub.sx, hub.sy);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      const twinkle = 0.45 + 0.35 * Math.sin(t * s.twinkleSpeed + s.twinklePhase);
      ctx.globalAlpha = Math.min(1, twinkle * ca + (hot ? 0.25 : 0));
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, TAU);
      ctx.fill();
    }

    // Hub glow (radial gradient) + core + white-hot center.
    const hubR = hub.r * (hot ? 1.18 : 1);
    const glowR = hubR * (hot ? 4 : 3.2);
    const grad = ctx.createRadialGradient(hub.sx, hub.sy, 0, hub.sx, hub.sy, glowR);
    grad.addColorStop(0, hub.glowIn);
    grad.addColorStop(1, hub.glowOut);
    ctx.globalAlpha = ca * (hot ? 1.4 : 1);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(hub.sx, hub.sy, glowR, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 0.95 * ca;
    ctx.fillStyle = hub.col;
    ctx.beginPath();
    ctx.arc(hub.sx, hub.sy, hubR, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = (hub.dim ? 0.3 : 0.85) * ca;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(hub.sx, hub.sy, hubR * 0.35, 0, TAU);
    ctx.fill();
  }

  // Pass 3 — tooltip, drawn last so it sits above everything.
  if (hovered !== -1) {
    const hub = hubs[hovered];
    const label = `${hub.label.toUpperCase()} · ${hub.count} ${
      hub.count === 1 ? 'LEARNING' : 'LEARNINGS'
    }`;
    ctx.font = MONO_FONT;
    const tw = ctx.measureText(label).width;
    const bw = tw + 30;
    const bh = 24;
    const bx = Math.min(w - bw - 6, Math.max(6, hub.sx - bw / 2));
    let by = hub.sy - hub.r - bh - 12;
    if (by < 6) by = hub.sy + hub.r + 12;

    ctx.globalAlpha = 1;
    roundRectPath(ctx, bx, by, bw, bh, 6);
    ctx.fillStyle = 'rgba(10,7,4,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = hub.col;
    ctx.beginPath();
    ctx.arc(bx + 12, by + bh / 2, 2.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(245,245,242,0.92)';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 20, by + bh / 2 + 0.5);
  }

  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export function KnowledgeMap({ learnings, className }: KnowledgeMapProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const model = useMemo(() => buildModel(learnings), [learnings]);
  const modelRef = useRef<HubNode[]>(model);
  const redrawRef = useRef<(() => void) | null>(null);

  // New data → swap the model behind the loop's back and repaint once
  // (the animated path would pick it up next frame anyway; this covers
  // the static reduced-motion / hidden paths).
  useEffect(() => {
    modelRef.current = model;
    redrawRef.current?.();
  }, [model]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let running = false;
    let width = 1;
    let height = 1;
    let mouse: { x: number; y: number } | null = null;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = mq.matches;

    const draw = (tMs: number) => {
      drawFrame(ctx, modelRef.current, width, height, reduced ? 0 : tMs / 1000, mouse);
    };
    const tick = (tMs: number) => {
      draw(tMs);
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (running || reduced || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };
    /** One static frame — used whenever the loop is not running. */
    const still = () => draw(0);

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!running) still();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onMotionPref = () => {
      reduced = mq.matches;
      if (reduced) {
        stop();
        still();
      } else {
        start();
      }
    };
    mq.addEventListener('change', onMotionPref);

    const onPointerMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      if (!running) still();
    };
    const onPointerLeave = () => {
      mouse = null;
      if (!running) still();
    };
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);

    redrawRef.current = () => {
      if (!running) still();
    };

    start();
    if (!running) still();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      mq.removeEventListener('change', onMotionPref);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      redrawRef.current = null;
    };
  }, []);

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className ?? ''}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Knowledge map — learnings clustered by error class"
      />
    </div>
  );
}
