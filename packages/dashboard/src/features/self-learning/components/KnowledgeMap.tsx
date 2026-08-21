import { useEffect, useRef } from 'react';
import type { Learning } from '../../../api/learnings';

/**
 * KnowledgeMap — a proper KNOWLEDGE GRAPH of what the AI knows: labeled
 * concept nodes (error classes, sized by how much was learned) connected to
 * their individual learning nodes and to related concepts, laid out with a
 * small deterministic force simulation baked at build time so it reads like a
 * real graph, not decoration. Gentle drift + twinkle at runtime; hover any
 * node to highlight its edges and read what it is. Canvas-only, DPR-aware,
 * pauses when hidden, static under reduced motion.
 */

export interface KnowledgeMapProps {
  learnings: Learning[];
  className?: string;
}

const PALETTE = ['#8B5CF6', '#52D273', '#3b82f6', '#F16524', '#ef4444', '#22d3ee'];

interface GNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // px radius at dpr 1
  color: string;
  label: string | null; // concept label (always drawn) or null
  tip: string | null; // hover tooltip
  concept: boolean;
  phase: number;
}

interface GEdge {
  a: number;
  b: number;
  w: number; // stroke alpha
}

function makeRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hexRgb(hex: string): string {
  const int = parseInt(hex.slice(1), 16);
  return `${(int >> 16) & 255},${(int >> 8) & 255},${int & 255}`;
}

/** Build nodes/edges and relax them with a tiny deterministic force sim. */
function buildGraph(learnings: Learning[]): { nodes: GNode[]; edges: GEdge[] } {
  const rand = makeRand(133742);
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];

  const byClass = new Map<string, Learning[]>();
  learnings.forEach((l) => {
    const k = l.errorClass.toLowerCase();
    const arr = byClass.get(k);
    if (arr) arr.push(l);
    else byClass.set(k, [l]);
  });
  const classes = [...byClass.entries()].slice(0, 6);

  // concept nodes (always labeled)
  const conceptIdx: number[] = [];
  classes.forEach(([name, ls], i) => {
    conceptIdx.push(nodes.length);
    nodes.push({
      x: 0.5 + (rand() - 0.5) * 0.6,
      y: 0.5 + (rand() - 0.5) * 0.6,
      vx: 0,
      vy: 0,
      r: 5 + Math.min(6, ls.reduce((a, l) => a + l.confirmations, 0)),
      color: PALETTE[i % PALETTE.length],
      label: name,
      tip: `${name} · ${ls.length} learning${ls.length === 1 ? '' : 's'}`,
      concept: true,
      phase: rand() * Math.PI * 2,
    });
  });

  // filler concepts keep the graph readable while knowledge is young
  const fillers = Math.max(0, 5 - classes.length);
  const FILLER_LABELS = ['services', 'deploys', 'alerts', 'traces', 'queries'];
  for (let f = 0; f < fillers; f++) {
    conceptIdx.push(nodes.length);
    nodes.push({
      x: 0.5 + (rand() - 0.5) * 0.7,
      y: 0.5 + (rand() - 0.5) * 0.7,
      vx: 0,
      vy: 0,
      r: 4,
      color: '#6b7186',
      label: FILLER_LABELS[f],
      tip: `${FILLER_LABELS[f]} · observing`,
      concept: true,
      phase: rand() * Math.PI * 2,
    });
  }

  // learning nodes attach to their concept
  classes.forEach(([, ls], i) => {
    const ci = conceptIdx[i];
    ls.slice(0, 8).forEach((l) => {
      const idx = nodes.length;
      nodes.push({
        x: nodes[ci].x + (rand() - 0.5) * 0.2,
        y: nodes[ci].y + (rand() - 0.5) * 0.2,
        vx: 0,
        vy: 0,
        r: 2 + Math.min(2.5, l.confirmations * 0.8),
        color: l.rating < 0 ? '#ef4444' : nodes[ci].color,
        label: null,
        tip: l.rootCause.length > 70 ? `${l.rootCause.slice(0, 70)}…` : l.rootCause,
        concept: false,
        phase: rand() * Math.PI * 2,
      });
      edges.push({ a: ci, b: idx, w: 0.3 });
    });
  });

  // small satellite nodes for filler concepts
  conceptIdx.slice(classes.length).forEach((ci) => {
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const idx = nodes.length;
      nodes.push({
        x: nodes[ci].x + (rand() - 0.5) * 0.2,
        y: nodes[ci].y + (rand() - 0.5) * 0.2,
        vx: 0,
        vy: 0,
        r: 1.6,
        color: '#565b6e',
        label: null,
        tip: null,
        concept: false,
        phase: rand() * Math.PI * 2,
      });
      edges.push({ a: ci, b: idx, w: 0.18 });
    }
  });

  // concept↔concept relations (ring + one chord) — the "graph" reading
  for (let i = 0; i < conceptIdx.length; i++) {
    edges.push({
      a: conceptIdx[i],
      b: conceptIdx[(i + 1) % conceptIdx.length],
      w: 0.14,
    });
  }
  if (conceptIdx.length > 3) {
    edges.push({ a: conceptIdx[0], b: conceptIdx[Math.floor(conceptIdx.length / 2)], w: 0.1 });
  }

  // ── deterministic force relaxation (baked) ──
  for (let iter = 0; iter < 220; iter++) {
    // pairwise repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) {
          dx = 0.01;
          dy = 0.01;
          d2 = 0.0002;
        }
        const rep = (nodes[i].concept && nodes[j].concept ? 0.0045 : 0.0011) / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * rep;
        const fy = (dy / d) * rep;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }
    // spring attraction along edges
    for (const e of edges) {
      const A = nodes[e.a];
      const B = nodes[e.b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const target = A.concept && B.concept ? 0.34 : 0.12;
      const f = (d - target) * 0.02;
      A.vx += (dx / d) * f;
      A.vy += (dy / d) * f;
      B.vx -= (dx / d) * f;
      B.vy -= (dy / d) * f;
    }
    // gravity to center + integrate + damp + clamp
    for (const n of nodes) {
      n.vx += (0.5 - n.x) * 0.004;
      n.vy += (0.5 - n.y) * 0.006;
      n.x += n.vx;
      n.y += n.vy;
      n.vx *= 0.72;
      n.vy *= 0.72;
      n.x = Math.min(0.94, Math.max(0.06, n.x));
      n.y = Math.min(0.88, Math.max(0.12, n.y));
    }
  }
  return { nodes, edges };
}

export function KnowledgeMap({ learnings, className }: KnowledgeMapProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const { nodes, edges } = buildGraph(learnings);

    let W = 0;
    let H = 0;
    let dpr = 1;
    let hoverIdx = -1;

    const nodeXY = (n: GNode, t: number): [number, number] => [
      (n.x + (reduced ? 0 : Math.sin(t * 0.4 + n.phase) * 0.006)) * W,
      (n.y + (reduced ? 0 : Math.cos(t * 0.5 + n.phase * 1.3) * 0.006)) * H,
    ];

    const draw = (t: number): void => {
      ctx.clearRect(0, 0, W, H);

      // edges (highlight those touching the hovered node)
      for (const e of edges) {
        const A = nodes[e.a];
        const B = nodes[e.b];
        const [ax, ay] = nodeXY(A, t);
        const [bx, by] = nodeXY(B, t);
        const hot = hoverIdx === e.a || hoverIdx === e.b;
        const col = hot ? hexRgb(nodes[hoverIdx].color) : '255,255,255';
        ctx.strokeStyle = `rgba(${col},${hot ? 0.55 : e.w * 0.35})`;
        ctx.lineWidth = (hot ? 1.4 : 0.8) * dpr;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }

      // nodes
      ctx.globalCompositeOperation = 'lighter';
      nodes.forEach((n, i) => {
        const [x, y] = nodeXY(n, t);
        const rgb = hexRgb(n.color);
        const hot = i === hoverIdx ? 1.5 : 1;
        const tw = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 1.4 + n.phase * 5);
        const R = n.r * dpr * hot;
        const glowR = R * (n.concept ? 4.5 : 3);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, glowR);
        grad.addColorStop(0, `rgba(${rgb},${(n.concept ? 0.55 : 0.35) * tw * hot})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
        ctx.fillStyle = n.concept ? 'rgba(255,255,255,0.95)' : `rgba(${rgb},0.95)`;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.4 * dpr, R * 0.55), 0, Math.PI * 2);
        ctx.fill();
      });

      // concept labels (always visible — this is what makes it a graph)
      ctx.globalCompositeOperation = 'source-over';
      const fs = 9.5 * dpr;
      ctx.font = `${fs}px "JetBrains Mono", ui-monospace, monospace`;
      nodes.forEach((n, i) => {
        if (!n.concept || !n.label) return;
        const [x, y] = nodeXY(n, t);
        const text = n.label;
        const w = ctx.measureText(text).width;
        ctx.fillStyle = i === hoverIdx ? `rgba(${hexRgb(n.color)},1)` : 'rgba(255,255,255,0.55)';
        ctx.fillText(text, x - w / 2, y + (n.r + 12) * dpr);
      });

      // hover tooltip
      if (hoverIdx >= 0 && nodes[hoverIdx].tip) {
        const n = nodes[hoverIdx];
        const [x, y] = nodeXY(n, t);
        const text = n.tip!;
        const fs2 = 10 * dpr;
        ctx.font = `${fs2}px "JetBrains Mono", ui-monospace, monospace`;
        const w = ctx.measureText(text).width;
        const bx = Math.min(Math.max(x - w / 2, 6 * dpr), W - w - 6 * dpr);
        const by = Math.max(y - (n.r + 22) * dpr, fs2 + 8 * dpr);
        ctx.fillStyle = 'rgba(4,4,6,0.92)';
        ctx.fillRect(bx - 6 * dpr, by - fs2 - 4 * dpr, w + 12 * dpr, fs2 + 10 * dpr);
        ctx.strokeStyle = `rgba(${hexRgb(n.color)},0.55)`;
        ctx.lineWidth = dpr;
        ctx.strokeRect(bx - 6 * dpr, by - fs2 - 4 * dpr, w + 12 * dpr, fs2 + 10 * dpr);
        ctx.fillStyle = 'rgba(245,245,242,0.92)';
        ctx.fillText(text, bx, by);
      }
    };

    const resize = (): void => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = Math.max(1, Math.round(r.width * dpr));
      H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W;
      canvas.height = H;
      draw(last);
    };

    const onMove = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * W;
      const my = ((e.clientY - r.top) / r.height) * H;
      hoverIdx = -1;
      let bd = Infinity;
      nodes.forEach((n, i) => {
        const d = Math.hypot(n.x * W - mx, n.y * H - my);
        if (d < 18 * dpr && d < bd && n.tip) {
          bd = d;
          hoverIdx = i;
        }
      });
      if (!running) draw(last);
    };
    const onLeave = (): void => {
      hoverIdx = -1;
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);

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

  return <canvas ref={ref} className={`block w-full ${className ?? ''}`} />;
}
