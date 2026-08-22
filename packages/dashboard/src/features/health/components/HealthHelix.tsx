import { useEffect, useRef } from 'react';
import type { HealthReport } from '../../../api/healthReport';

/**
 * HealthHelix — the report's living centerpiece: the repo rendered as a
 * PATIENT under scan. A rotating 3D DNA double-helix whose rungs are colored
 * by the project's real language mix ("the genetic code of the repo"); the
 * AI's issues sit on the strand as glowing mutations (red critical / orange
 * warning / blue info — hover one for its title); a scanner beam sweeps the
 * helix; and underneath, an ECG heartbeat whose rhythm follows the health
 * score — calm steady pulse for an A, fast irregular beat for a poor grade.
 * Canvas-only, DPR-aware, pauses when hidden, static under reduced motion.
 */

const LANG_PALETTE = ['#F16524', '#8B5CF6', '#3b82f6', '#52D273', '#22d3ee', '#eab308'];

const SEV_COLOR: Record<string, string> = {
  critical: '#FF3B30',
  warning: '#FF8233',
  info: '#3b82f6',
};

function hexRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export function HealthHelix({ report }: { report: HealthReport }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* rung colors from the real language mix */
    const RUNGS = 40;
    const langs = report.stats.languages.length
      ? report.stats.languages
      : [{ name: 'code', pct: 100 }];
    const rungColor: string[] = [];
    langs.forEach((l, i) => {
      const n = Math.max(1, Math.round((l.pct / 100) * RUNGS));
      for (let k = 0; k < n && rungColor.length < RUNGS; k++) {
        rungColor.push(LANG_PALETTE[i % LANG_PALETTE.length]);
      }
    });
    while (rungColor.length < RUNGS) rungColor.push(LANG_PALETTE[0]);

    /* mutations: top issues pinned to rungs, spread along the strand */
    const issues = report.quality.issues.slice(0, 8);
    const mutations = issues.map((iss, i) => ({
      rung: Math.floor(((i + 1) / (issues.length + 1)) * RUNGS),
      side: i % 2 === 0 ? 1 : -1,
      color: SEV_COLOR[iss.severity] ?? '#FF8233',
      title: iss.title,
      sev: iss.severity,
    }));

    /* score-driven heartbeat */
    const score = report.score;
    const beatMs = score >= 80 ? 1000 : score >= 60 ? 780 : 560;
    const jitter = score >= 80 ? 0 : score >= 60 ? 0.08 : 0.22;
    const ecgColor = score >= 80 ? '#52D273' : score >= 60 ? '#FF8233' : '#FF3B30';

    let W = 0;
    let H = 0;
    let dpr = 1;
    let mx = -1e4;
    let my = -1e4;
    let hover: { x: number; y: number; title: string; sev: string; color: string } | null =
      null;

    const resize = (): void => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = Math.max(1, Math.round(r.width * dpr));
      H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W;
      canvas.height = H;
      draw(0);
    };

    const onMove = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      mx = ((e.clientX - r.left) / r.width) * W;
      my = ((e.clientY - r.top) / r.height) * H;
    };
    const onLeave = (): void => {
      mx = -1e4;
      my = -1e4;
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);

    const draw = (t: number): void => {
      ctx.clearRect(0, 0, W, H);
      const ecgH = 56 * dpr;
      const helixTop = 10 * dpr;
      const helixBottom = H - ecgH - 14 * dpr;
      const helixH = helixBottom - helixTop;
      const cx = W / 2;
      const amp = Math.min(W * 0.3, 120 * dpr);
      const rot = reduced ? 0.6 : t * 0.55;

      /* scanner beam position (sweeps every 4s) */
      const scanU = reduced ? 0.35 : (t % 4) / 4;
      const scanY = helixTop + scanU * helixH;

      /* helix points, back-to-front */
      interface P {
        x: number;
        y: number;
        z: number;
        i: number;
      }
      const strandA: P[] = [];
      const strandB: P[] = [];
      for (let i = 0; i < RUNGS; i++) {
        const u = i / (RUNGS - 1);
        const y = helixTop + u * helixH;
        const th = u * Math.PI * 3.2 + rot;
        strandA.push({ x: cx + Math.sin(th) * amp, y, z: Math.cos(th), i });
        strandB.push({ x: cx + Math.sin(th + Math.PI) * amp, y, z: Math.cos(th + Math.PI), i });
      }

      /* rungs (draw far halves first for depth) */
      const drawRung = (a: P, b: P): void => {
        const depth = (a.z + 1) / 2; // 0 far → 1 near
        const near = Math.abs(a.y - scanY) < 26 * dpr ? 1.6 : 1;
        const rgb = hexRgb(rungColor[a.i]);
        ctx.strokeStyle = `rgba(${rgb},${(0.16 + depth * 0.45) * near})`;
        ctx.lineWidth = (0.8 + depth * 1.4) * dpr;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      };
      const rungs = strandA.map((a, i) => ({ a, b: strandB[i] }));
      rungs
        .slice()
        .sort((r1, r2) => r1.a.z - r2.a.z)
        .forEach(({ a, b }) => drawRung(a, b));

      /* strands */
      const drawStrand = (pts: P[]): void => {
        for (let i = 1; i < pts.length; i++) {
          const depth = (pts[i].z + 1) / 2;
          ctx.strokeStyle = `rgba(245,245,242,${0.1 + depth * 0.5})`;
          ctx.lineWidth = (1 + depth * 1.6) * dpr;
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
      };
      drawStrand(strandA);
      drawStrand(strandB);

      /* mutations — glowing pulsing nodes on the strand */
      ctx.globalCompositeOperation = 'lighter';
      hover = null;
      for (const m of mutations) {
        const p = (m.side > 0 ? strandA : strandB)[m.rung];
        if (!p) continue;
        const rgb = hexRgb(m.color);
        const pulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 3 + m.rung);
        const R = (10 + ((p.z + 1) / 2) * 6) * dpr * pulse;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
        g.addColorStop(0, `rgba(${rgb},0.9)`);
        g.addColorStop(0.4, `rgba(${rgb},0.25)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2);
        ctx.fillStyle = `rgba(255,255,255,0.95)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 * dpr, 0, Math.PI * 2);
        ctx.fill();
        if (Math.hypot(p.x - mx, p.y - my) < 16 * dpr) {
          hover = { x: p.x, y: p.y, title: m.title, sev: m.sev, color: m.color };
        }
      }

      /* scanner beam */
      if (!reduced) {
        const bg = ctx.createLinearGradient(0, scanY - 18 * dpr, 0, scanY + 18 * dpr);
        bg.addColorStop(0, 'rgba(34,211,238,0)');
        bg.addColorStop(0.5, 'rgba(34,211,238,0.16)');
        bg.addColorStop(1, 'rgba(34,211,238,0)');
        ctx.fillStyle = bg;
        ctx.fillRect(cx - amp - 24 * dpr, scanY - 18 * dpr, (amp + 24 * dpr) * 2, 36 * dpr);
        ctx.fillStyle = 'rgba(34,211,238,0.5)';
        ctx.fillRect(cx - amp - 24 * dpr, scanY - dpr * 0.6, (amp + 24 * dpr) * 2, dpr * 1.2);
      }
      ctx.globalCompositeOperation = 'source-over';

      /* ECG heartbeat — rhythm from the score */
      const baseY = H - ecgH / 2;
      const rgbE = hexRgb(ecgColor);
      ctx.strokeStyle = `rgba(${rgbE},0.85)`;
      ctx.lineWidth = 1.4 * dpr;
      ctx.beginPath();
      const span = W;
      for (let px = 0; px <= span; px += 2 * dpr) {
        const timeAt = t - (span - px) / (90 * dpr); // trace scrolls left
        const beatT = ((timeAt * 1000) % beatMs) / beatMs;
        const irregular = jitter ? Math.sin(timeAt * 13.7) * jitter : 0;
        const bt = (beatT + irregular + 1) % 1;
        let dy = 0;
        if (bt > 0.62 && bt < 0.66) dy = -4;
        else if (bt >= 0.66 && bt < 0.7) dy = 26;
        else if (bt >= 0.7 && bt < 0.76) dy = -34;
        else if (bt >= 0.76 && bt < 0.8) dy = 8;
        else if (bt >= 0.85 && bt < 0.93) dy = -6 * Math.sin((bt - 0.85) / 0.08 * Math.PI);
        const y = baseY - dy * dpr * (reduced ? 0.4 : 1);
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
      // glow head
      ctx.globalCompositeOperation = 'lighter';
      const hg = ctx.createRadialGradient(W - 4 * dpr, baseY, 0, W - 4 * dpr, baseY, 14 * dpr);
      hg.addColorStop(0, `rgba(${rgbE},0.8)`);
      hg.addColorStop(1, `rgba(${rgbE},0)`);
      ctx.fillStyle = hg;
      ctx.fillRect(W - 18 * dpr, baseY - 14 * dpr, 18 * dpr, 28 * dpr);
      ctx.globalCompositeOperation = 'source-over';
      // ecg label
      ctx.font = `${9 * dpr}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillStyle = `rgba(${rgbE},0.7)`;
      const bpm = Math.round(60000 / beatMs);
      ctx.fillText(`PROJECT VITALS · ${bpm} BPM`, 8 * dpr, H - ecgH - 2 * dpr);

      /* hover tooltip for a mutation */
      if (hover) {
        const hv = hover;
        const text = `${hv.sev.toUpperCase()} · ${hv.title}`;
        const fs = 10 * dpr;
        ctx.font = `${fs}px "JetBrains Mono", ui-monospace, monospace`;
        const tw = Math.min(ctx.measureText(text).width, W - 24 * dpr);
        const bx = Math.min(Math.max(hv.x - tw / 2, 8 * dpr), W - tw - 8 * dpr);
        const by = Math.max(hv.y - 22 * dpr, fs + 6 * dpr);
        ctx.fillStyle = 'rgba(4,4,6,0.92)';
        ctx.fillRect(bx - 6 * dpr, by - fs - 4 * dpr, tw + 12 * dpr, fs + 10 * dpr);
        ctx.strokeStyle = `rgba(${hexRgb(hv.color)},0.6)`;
        ctx.lineWidth = dpr;
        ctx.strokeRect(bx - 6 * dpr, by - fs - 4 * dpr, tw + 12 * dpr, fs + 10 * dpr);
        ctx.fillStyle = 'rgba(245,245,242,0.95)';
        ctx.fillText(text, bx, by, W - 24 * dpr);
      }
    };

    let raf = 0;
    let running = false;
    const loop = (now: number): void => {
      draw(now / 1000);
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
    if (reduced) draw(0.6);
    else start();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [report]);

  return <canvas ref={ref} className="block h-full w-full" />;
}
