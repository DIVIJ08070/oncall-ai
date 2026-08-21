import { useEffect, useRef } from 'react';

/**
 * TerrainNetwork — the hero mountain as a baked cinematic still (the user's
 * reference look, rendered offline to /hero-terrain.jpg) brought to life with
 * a light overlay: breathing glow pockets, a FEW slow signal motes tracing
 * the ridgelines, a ~16s incident flare on the ember flank, and ~1.5% cursor
 * parallax on the image itself. No WebGL required; the overlay pauses when
 * hidden and disappears entirely under prefers-reduced-motion.
 *
 * To swap in a different mountain render, replace public/hero-terrain.jpg —
 * no code changes needed.
 */

/** Ridge polylines in image-fraction coordinates for the motes to follow. */
const RIDGES: Array<Array<[number, number]>> = [
  [[0.05, 0.55], [0.13, 0.4], [0.22, 0.25], [0.31, 0.08], [0.38, 0.16], [0.44, 0.3]],
  [[0.5, 0.42], [0.56, 0.32], [0.62, 0.2], [0.68, 0.1], [0.74, 0.06]],
  [[0.78, 0.28], [0.84, 0.2], [0.9, 0.28], [0.97, 0.22]],
  [[0.1, 0.8], [0.3, 0.72], [0.5, 0.7], [0.7, 0.66], [0.9, 0.62]],
];

/** Glow pockets (image fractions) matching the baked hot zones. */
const GLOWS = [
  { x: 0.7, y: 0.42, r: 0.17, color: '255,110,50', hot: true }, // ember flank
  { x: 0.76, y: 0.3, r: 0.11, color: '239,68,58', hot: false },
  { x: 0.55, y: 0.62, r: 0.07, color: '150,95,255', hot: false },
  { x: 0.56, y: 0.36, r: 0.055, color: '170,110,255', hot: false },
];

const MOTES = Array.from({ length: 8 }, (_, i) => ({
  ridge: i % RIDGES.length,
  u: (i * 0.37) % 1,
  speed: 0.012 + (i % 3) * 0.005, // few and slow
  color: i % 3 === 0 ? '255,255,255' : i % 3 === 1 ? '255,138,90' : '176,123,255',
}));

function pointOn(ridge: Array<[number, number]>, u: number): [number, number] {
  const t = u * (ridge.length - 1);
  const i = Math.min(ridge.length - 2, Math.floor(t));
  const f = t - i;
  return [
    ridge[i][0] + (ridge[i + 1][0] - ridge[i][0]) * f,
    ridge[i][1] + (ridge[i + 1][1] - ridge[i][1]) * f,
  ];
}

export function TerrainNetwork({ className }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !img || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* parallax: the image (and overlay) ease toward the cursor by ~1.5% */
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    const onMove = (e: PointerEvent): void => {
      const r = wrap.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * -2;
      ty = ((e.clientY - r.top) / r.height - 0.5) * -2;
    };
    const onLeave = (): void => {
      tx = 0;
      ty = 0;
    };
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerleave', onLeave);

    let W = 0;
    let H = 0;
    const resize = (): void => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = Math.max(1, Math.round(r.width * dpr));
      H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W;
      canvas.height = H;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const motes = MOTES.map((m) => ({ ...m }));
    let raf = 0;
    let running = false;
    const t0 = performance.now();

    const frame = (): void => {
      const t = (performance.now() - t0) / 1000;

      // eased parallax applied to both layers
      cx += (tx - cx) * 0.05;
      cy += (ty - cy) * 0.05;
      const shift = `translate(${cx * 1.5}%, ${cy * 1.2}%) scale(1.06)`;
      img.style.transform = shift;
      canvas.style.transform = shift;

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      // incident: the ember flank flares every ~16s, then recovers
      const cycle = (t % 16) / 16;
      const hot = cycle > 0.45 && cycle < 0.75 ? Math.sin(((cycle - 0.45) / 0.3) * Math.PI) : 0;

      for (const g of GLOWS) {
        const breathe = 0.8 + Math.sin(t * 0.45 + g.x * 9) * 0.2;
        const boost = g.hot ? hot * 0.5 : 0;
        const R = g.r * W * (1 + boost * 0.3);
        const grad = ctx.createRadialGradient(g.x * W, g.y * H, 0, g.x * W, g.y * H, R);
        grad.addColorStop(0, `rgba(${g.color},${(0.1 + boost * 0.22) * breathe})`);
        grad.addColorStop(1, `rgba(${g.color},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(g.x * W - R, g.y * H - R, R * 2, R * 2);
      }

      for (const m of motes) {
        m.u += m.speed * (1 + hot * 1.4) * (1 / 60);
        if (m.u > 1) {
          m.u = 0;
          m.ridge = (m.ridge + 1) % RIDGES.length;
        }
        const [fx, fy] = pointOn(RIDGES[m.ridge], m.u);
        const px = fx * W;
        const py = fy * H;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, 7);
        grad.addColorStop(0, `rgba(${m.color},0.9)`);
        grad.addColorStop(0.4, `rgba(${m.color},0.25)`);
        grad.addColorStop(1, `rgba(${m.color},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(px - 7, py - 7, 14, 14);
      }

      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    };

    const start = (): void => {
      if (running || reduced || document.visibilityState === 'hidden') return;
      running = true;
      raf = requestAnimationFrame(frame);
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
    start();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div ref={wrapRef} aria-hidden className={`absolute inset-0 overflow-hidden ${className ?? ''}`}>
      <img
        ref={imgRef}
        src="/hero-terrain.jpg"
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover object-[68%_30%]"
        style={{ transform: 'scale(1.06)' }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ transform: 'scale(1.06)' }}
      />
    </div>
  );
}
