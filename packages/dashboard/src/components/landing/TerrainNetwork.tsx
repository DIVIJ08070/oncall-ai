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
/**
 * Ridge polylines TRACED FROM THE IMAGE ITSELF (offline bright-band chaining
 * over hero-terrain.jpg columns), so the circuit lines ride the real mountain
 * contours. Each is a service dependency route with a name + live rate.
 */
const ROUTES: Array<{
  path: Array<[number, number]>;
  color: string;
  label: string;
  base: number; // baseline req/s for the live rate readout
}> = [
  {
    path: [[0.361, 0.577], [0.428, 0.628], [0.483, 0.599], [0.539, 0.491], [0.605, 0.504], [0.661, 0.383], [0.727, 0.402], [0.783, 0.354], [0.872, 0.37], [0.894, 0.383]],
    color: '132,138,160', label: 'CHECKOUT \u2192 DATABASE', base: 96,
  },
  {
    path: [[0.305, 0.478], [0.35, 0.456], [0.394, 0.475], [0.438, 0.434], [0.483, 0.491], [0.528, 0.424], [0.594, 0.37], [0.65, 0.296], [0.694, 0.322], [0.739, 0.233]],
    color: '255,138,90', label: 'AUTH \u2192 PAYMENT', base: 142,
  },
  {
    path: [[0.183, 0.823], [0.217, 0.778], [0.25, 0.854], [0.283, 0.886], [0.328, 0.918], [0.361, 0.937], [0.394, 0.915], [0.428, 0.88], [0.461, 0.816], [0.494, 0.749]],
    color: '176,123,255', label: 'INGEST STREAM', base: 421,
  },
  {
    path: [[0.127, 0.59], [0.172, 0.58], [0.205, 0.599], [0.239, 0.577], [0.272, 0.539], [0.305, 0.593], [0.339, 0.65], [0.372, 0.654], [0.394, 0.67]],
    color: '132,138,160', label: 'USER-SERVICE \u2192 CACHE', base: 63,
  },
  {
    path: [[0.028, 0.743], [0.072, 0.736], [0.094, 0.692], [0.117, 0.711], [0.139, 0.701], [0.161, 0.717], [0.183, 0.708], [0.227, 0.736], [0.25, 0.698], [0.272, 0.676], [0.283, 0.67]],
    color: '176,123,255', label: 'NOTIFICATIONS', base: 18,
  },
  {
    path: [[0.75, 0.634], [0.772, 0.657], [0.805, 0.603], [0.839, 0.663], [0.872, 0.701], [0.894, 0.695], [0.916, 0.647], [0.938, 0.574], [0.961, 0.564], [0.983, 0.529]],
    color: '239,110,80', label: 'PAYMENT-GATEWAY \u00b7 DEGRADED', base: 87,
  },
];
const RIDGES = ROUTES.map((r) => r.path);

/** Glow pockets (image fractions) matching the baked hot zones. */
const GLOWS = [
  { x: 0.8, y: 0.45, r: 0.13, color: '255,110,50', hot: true }, // ember flank
  { x: 0.9, y: 0.55, r: 0.1, color: '239,68,58', hot: false },
  { x: 0.46, y: 0.53, r: 0.05, color: '150,95,255', hot: false },
  { x: 0.86, y: 0.4, r: 0.045, color: '170,110,255', hot: false },
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

    /* The mountain itself stays STILL — only the circuit lines react. */
    let px = -1e4; // pointer in canvas fractions
    let py = -1e4;
    const onMove = (e: PointerEvent): void => {
      const r = wrap.getBoundingClientRect();
      px = (e.clientX - r.left) / r.width;
      py = (e.clientY - r.top) / r.height;
    };
    const onLeave = (): void => {
      px = -1e4;
      py = -1e4;
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

      // living circuit lines along the ridges — marching dashes that flow
      // continuously and BRIGHTEN near the cursor (interactive, alive)
      let hovered: { ri: number; near: number } | null = null;
      for (let ri = 0; ri < RIDGES.length; ri++) {
        const ridge = RIDGES[ri];
        const color = ROUTES[ri].color;
        // proximity of the pointer to this ridge (nearest sample point)
        let near = 0;
        if (px > -100) {
          for (let k = 0; k <= 10; k++) {
            const [fx, fy] = pointOn(ridge, k / 10);
            const d = Math.hypot(fx - px, fy - py);
            near = Math.max(near, Math.max(0, 1 - d / 0.22));
          }
        }
        ctx.beginPath();
        ridge.forEach(([fx, fy], i) => {
          if (i === 0) ctx.moveTo(fx * W, fy * H);
          else ctx.lineTo(fx * W, fy * H);
        });
        ctx.setLineDash([3 * (W / 800), 14 * (W / 800)]);
        ctx.lineDashOffset = -t * 26 * (1 + near * 3) - ri * 7;
        ctx.lineWidth = (1 + near * 2.6) * (W / 1400);
        ctx.strokeStyle = `rgba(${color},${Math.min(1, 0.07 + near * 0.5 + hot * 0.04)})`;
        ctx.stroke();
        if (near > 0.35) {
          // hot segment glow under the cursor
          ctx.setLineDash([]);
          ctx.lineWidth = 6 * (W / 1400);
          ctx.strokeStyle = `rgba(${color},${0.16 * near})`;
          ctx.stroke();
        }
        ctx.setLineDash([]);
        if (near > 0.45 && (hovered === null || near > hovered.near)) hovered = { ri, near };
      }

      // the hovered route explains itself: name + live rate near the cursor
      if (hovered && px > -100) {
        const route = ROUTES[hovered.ri];
        const rate = Math.round(route.base * (1 + Math.sin(t * 1.3 + hovered.ri) * 0.12 + hot * 0.6));
        const text = `${route.label} \u00b7 ${rate} req/s`;
        const fs = Math.max(11, 12 * (W / 1400));
        ctx.font = `${fs}px "JetBrains Mono", ui-monospace, monospace`;
        const tw = ctx.measureText(text).width;
        const bx = Math.min(Math.max(px * W - tw / 2, 8), W - tw - 8);
        const by = Math.max(py * H - 26 * (W / 1400), fs + 6);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(4,4,6,0.9)';
        ctx.fillRect(bx - 8, by - fs - 5, tw + 16, fs + 12);
        ctx.strokeStyle = `rgba(${route.color},0.28)`;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx - 8, by - fs - 5, tw + 16, fs + 12);
        ctx.fillStyle = `rgba(${route.color},0.72)`;
        ctx.fillText(text, bx, by);
        ctx.globalCompositeOperation = 'lighter';
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
        className="absolute inset-0 h-full w-full select-none object-cover object-[70%_45%]"
        style={{ transform: 'scale(1.02)' }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ transform: 'scale(1.02)' }}
      />
    </div>
  );
}
