import { useMemo } from 'react';
import type { EndpointPerformance } from '@oncall/shared';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { GlassCard, MONO } from '../../../components/shell/UnifiedChrome';
import {
  scoreColor,
  STATUS_COLOR,
  STATUS_LABEL,
  WARNING_STATUSES,
  predictionLine,
} from '../lib/model';

/**
 * TrendPredictionCard — the breach forecast for one endpoint (AI PREVENTION deep
 * dive): a status banner tinted by the risk lifecycle, the bold breach line
 * ("may breach in ~14 min · 87%"), and an SVG sparkline of the endpoint's recent
 * performance scores. The parent accumulates `history` across its poll cadence,
 * so the sparkline fills in live as new windows are scored. Presentational.
 */

const SPARK_W = 260;
const SPARK_H = 56;
const PAD = 6;

export function TrendPredictionCard({
  endpoint: e,
  history,
}: {
  endpoint: EndpointPerformance;
  history: number[];
}) {
  const p = e.prediction;
  const warning = WARNING_STATUSES.has(p.status);
  const statusColor = STATUS_COLOR[p.status];

  // Latest score drives the sparkline color; ensure at least the current point.
  const points = useMemo(() => {
    const src = history.length > 0 ? history : [e.score.overall_score];
    return src.slice(-30).map((v) => Math.max(0, Math.min(100, v)));
  }, [history, e.score.overall_score]);

  const latest = points[points.length - 1];
  const first = points[0];
  const delta = points.length > 1 ? Math.round(latest - first) : 0;
  const lineColor = scoreColor(latest);

  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaColor = delta > 0 ? '#52D273' : delta < 0 ? '#FF6B5C' : 'rgba(255,255,255,0.4)';

  return (
    <GlassCard className="flex flex-col p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
          style={{
            color: statusColor,
            borderColor: statusColor + '55',
            backgroundColor: statusColor + '1f',
          }}
        >
          <TrendingUp className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <span
            className="block text-[10px] uppercase tracking-[0.2em] text-white/45"
            style={{ fontFamily: MONO }}
          >
            Breach Forecast
          </span>
          <span
            className="block truncate text-sm font-semibold text-white"
            title={`${e.service} · ${e.method} ${e.endpoint}`}
          >
            {e.service}
            <span className="text-white/35"> · </span>
            <span className="text-white/60" style={{ fontFamily: MONO }}>
              {e.method} {e.endpoint}
            </span>
          </span>
        </div>
      </div>

      {/* Risk banner */}
      <div
        className="mt-3 flex items-center gap-2.5 rounded-xl border px-3.5 py-3"
        style={{ borderColor: statusColor + (warning ? '55' : '33'), backgroundColor: statusColor + '14' }}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${warning ? 'motion-safe:animate-pulse-live' : ''}`}
          style={{ backgroundColor: statusColor }}
        />
        <div className="min-w-0">
          <span
            className="block text-[9px] uppercase tracking-[0.18em] text-white/45"
            style={{ fontFamily: MONO }}
          >
            {STATUS_LABEL[p.status]}
          </span>
          <span className="block text-sm font-bold tabular-nums" style={{ color: statusColor }}>
            {predictionLine(e)}
          </span>
        </div>
      </div>

      {/* Sparkline */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span
            className="text-[9px] uppercase tracking-[0.16em] text-white/40"
            style={{ fontFamily: MONO }}
          >
            Score trend
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] tabular-nums" style={{ color: deltaColor }}>
            <DeltaIcon className="h-3 w-3" />
            {delta > 0 ? `+${delta}` : delta}
          </span>
        </div>
        <Sparkline points={points} color={lineColor} />
      </div>

      {/* Human detail from the predictor */}
      {p.detail ? (
        <p className="mt-3 text-[11px] leading-relaxed text-white/45">{p.detail}</p>
      ) : null}
    </GlassCard>
  );
}

/** A 0-100 score sparkline with a soft area fill and an end-point marker. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  const n = points.length;
  const innerW = SPARK_W - PAD * 2;
  const innerH = SPARK_H - PAD * 2;
  const x = (i: number): number => (n <= 1 ? PAD + innerW : PAD + (i / (n - 1)) * innerW);
  const y = (v: number): number => PAD + (1 - v / 100) * innerH;

  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${(SPARK_H - PAD).toFixed(1)} L ${x(0).toFixed(1)} ${(
    SPARK_H - PAD
  ).toFixed(1)} Z`;
  const lastX = x(n - 1);
  const lastY = y(points[n - 1]);
  const gid = `spark-${color.replace('#', '')}`;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className="block h-14 w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Baseline gridlines at 50 and 85 (band thresholds) */}
      {[50, 85].map((g) => (
        <line
          key={g}
          x1={PAD}
          x2={SPARK_W - PAD}
          y1={y(g)}
          y2={y(g)}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      ))}
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r="3" fill={color} />
      <circle cx={lastX} cy={lastY} r="6" fill={color} fillOpacity="0.18" />
    </svg>
  );
}
