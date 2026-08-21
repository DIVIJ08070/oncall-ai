import { useEffect, useRef } from 'react';
import type { Learning } from '../../../api/learnings';

/**
 * KnowledgeMap — the AI's understanding as a field of radial constellations
 * (mockup look): each error class is a glowing hub with satellites on clean
 * spokes, hubs interlinked by faint threads, ambient filler clusters keeping
 * the field dense while real knowledge is young. Satellites orbit slowly,
 * dots twinkle, hubs breathe. Hover a REAL cluster for its name + count.
 * Canvas-only, DPR-aware, pauses when hidden, static under reduced motion.
 */

export interface KnowledgeMapProps {
  learnings: Learning[];
  className?: string;
}

const PALETTE = ['#8B5CF6', '#52D273', '#3b82f6', '#F16524', '#ef4444', '#22d3ee'];

interface Cluster {
  x: number; // canvas fraction
  y: number;
  color: string;
  label: string | null; // null = ambient filler
  count: number;
  sats: Array<{ r: number; a: number; size: number; bright: number; spoke: boolean }>;
  phase: number;
  spin: number;
}

function makeRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function buildClusters(learnings: Learning[]): Cluster[] {
  const rand = makeRand(424242);
  const byClass = new Map<string, Learning[]>();
  learnings.forEach((l) => {
    const k = l.errorClass.toLowerCase();
    const arr = byClass.get(k);
    if (arr) arr.push(l);
    else byClass.set(k, [l]);
  });
  const real = [...byClass.entries()].slice(0, 6);
  const total = Math.max(6, Math.min(7, real.length + 3));

  // spread slots on a jittered 2-row layout (mockup composition)
  const slots: Array<[number, number]> = [];
  const cols = Math.ceil(total / 2);
  for (let i = 0; i < total; i++) {
    const row = i % 2;
    const col = Math.floor(i / 2);
    slots.push([
      0.12 + (col + 0.5) / cols * 0.76 + (rand() - 0.5) * 0.07,
      0.28 + row * 0.42 + (rand() - 0.5) * 0.14,
    ]);
  }
  // shuffle slots deterministically
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  const clusters: Cluster[] = [];
  for (let i = 0; i < total; i++) {
    const entry = real[i];
    const confirms = entry
      ? entry[1].reduce((a, l) => a + l.confirmations, 0)
      : 0;
    const satCount = entry
      ? Math.min(26, 10 + confirms * 3)
      : 7 + Math.floor(rand() * 6);
    const sats: Cluster['sats'] = [];
    for (let k = 0; k < satCount; k++) {
      sats.push({
        r: 16 + rand() * 34,
        a: (k / satCount) * Math.PI * 2 + rand() * 0.5,
        size: 1.2 + rand() * 1.6,
        bright: 0.35 + rand() * 0.65,
        spoke: rand() < 0.7,
      });
    }
    clusters.push({
      x: slots[i][0],
      y: slots[i][1],
      color: PALETTE[i % PALETTE.length],
      label: entry ? entry[0] : null,
      count: entry ? entry[1].length : 0,
      sats,
      phase: rand() * Math.PI * 2,
      spin: (rand() < 0.5 ? 1 : -1) * (0.05 + rand() * 0.07),
    });
  }
  return clusters;
}

function hexRgb(hex: string): string {
  const int = parseInt(hex.slice(1), 16);
  return `${(int >> 16) & 255},${(int >> 8) & 255},${int & 255}`;
}

export function KnowledgeMap({ learnings, className }: KnowledgeMapProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clusters = buildClusters(learnings);

    let W = 0;
    let H = 0;
    let dpr = 1;
    const resize = (): void => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = Math.max(1, Math.round(r.width * dpr));
      H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W;
      canvas.height = H;
      draw(0);
    };

    let hoverIdx = -1;
    const onMove = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * W;
      const my = ((e.clientY - r.top) / r.height) * H;
      hoverIdx = -1;
      clusters.forEach((c, i) => {
        if (c.label && Math.hypot(c.x * W - mx, c.y * H - my) < 40 * dpr) hoverIdx = i;
      });
      if (!running) draw(last);
    };
    const onLeave = (): void => {
      hoverIdx = -1;
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);

    const draw = (t: number): void => {
      ctx.clearRect(0, 0, W, H);
      const px = (f: number): number => f * W;
      const py = (f: number): number => f * H;

      // inter-hub threads (each hub → nearest 2)
      ctx.globalCompositeOperation = 'source-over';
      clusters.forEach((c, i) => {
        const near = clusters
          .map((o, j) => ({ j, d: Math.hypot(o.x - c.x, o.y - c.y) }))
          .filter((e) => e.j !== i)
          .sort((a, b) => a.d - b.d)
          .slice(0, 2);
        for (const e of near) {
          if (e.j < i) continue;
          const o = clusters[e.j];
          ctx.strokeStyle = 'rgba(255,255,255,0.05)';
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.moveTo(px(c.x), py(c.y));
          ctx.lineTo(px(o.x), py(o.y));
          ctx.stroke();
        }
      });

      ctx.globalCompositeOperation = 'lighter';
      clusters.forEach((c, i) => {
        const rgb = hexRgb(c.color);
        const hx = px(c.x);
        const hy = py(c.y);
        const hot = i === hoverIdx ? 1.6 : 1;
        const breathe = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 0.7 + c.phase);

        // hub glow
        const R = 34 * dpr * hot;
        const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, R);
        grad.addColorStop(0, `rgba(${rgb},${0.5 * breathe * hot})`);
        grad.addColorStop(0.35, `rgba(${rgb},${0.14 * breathe})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(hx - R, hy - R, R * 2, R * 2);
        // hub core
        ctx.fillStyle = `rgba(255,255,255,${0.85 * hot > 1 ? 1 : 0.85})`;
        ctx.beginPath();
        ctx.arc(hx, hy, 3 * dpr * hot, 0, Math.PI * 2);
        ctx.fill();

        // satellites on spokes
        for (const s of c.sats) {
          const a = s.a + (reduced ? 0 : t * c.spin);
          const sx = hx + Math.cos(a) * s.r * dpr;
          const sy = hy + Math.sin(a) * s.r * dpr * 0.82;
          if (s.spoke) {
            ctx.strokeStyle = `rgba(${rgb},${0.16 * hot})`;
            ctx.lineWidth = dpr * 0.8;
            ctx.beginPath();
            ctx.moveTo(hx, hy);
            ctx.lineTo(sx, sy);
            ctx.stroke();
          }
          const tw = reduced ? 1 : 0.7 + 0.3 * Math.sin(t * 1.6 + s.a * 7 + c.phase);
          ctx.fillStyle = `rgba(${rgb},${Math.min(1, s.bright * tw * hot)})`;
          ctx.beginPath();
          ctx.arc(sx, sy, s.size * dpr, 0, Math.PI * 2);
          ctx.fill();
        }

        // label for real, hovered clusters
        if (i === hoverIdx && c.label) {
          ctx.globalCompositeOperation = 'source-over';
          const text = `${c.label} · ${c.count} learning${c.count === 1 ? '' : 's'}`;
          const fs = 11 * dpr;
          ctx.font = `${fs}px "JetBrains Mono", ui-monospace, monospace`;
          const tw2 = ctx.measureText(text).width;
          const bx = Math.min(Math.max(hx - tw2 / 2, 6 * dpr), W - tw2 - 6 * dpr);
          const by = Math.max(hy - 46 * dpr, fs + 8 * dpr);
          ctx.fillStyle = 'rgba(4,4,6,0.9)';
          ctx.fillRect(bx - 6 * dpr, by - fs - 4 * dpr, tw2 + 12 * dpr, fs + 10 * dpr);
          ctx.strokeStyle = `rgba(${rgb},0.5)`;
          ctx.lineWidth = dpr;
          ctx.strokeRect(bx - 6 * dpr, by - fs - 4 * dpr, tw2 + 12 * dpr, fs + 10 * dpr);
          ctx.fillStyle = `rgba(${rgb},0.95)`;
          ctx.fillText(text, bx, by);
          ctx.globalCompositeOperation = 'lighter';
        }
      });
      ctx.globalCompositeOperation = 'source-over';
    };

    let raf = 0;
    let running = false;
    let last = 0;
    const loop = (now: number): void => {
      last = now / 1000;
      draw(last);
      raf = requestAnimationFrame(loop);
    };
    const start = (): void => {
      if (running || reduced || document.visibilityState === 'hidden') return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = (): void => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    if (reduced) draw(0);
    else start();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [learnings]);

  return <canvas ref={ref} aria-hidden={false} className={`block w-full ${className ?? ''}`} />;
}
