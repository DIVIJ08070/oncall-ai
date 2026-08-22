import type { EndpointPerformance } from '@oncall/shared';
import { Gauge } from 'lucide-react';
import { GlassCard, MONO } from '../../../components/shell/UnifiedChrome';
import { ms, pct } from '../../../lib/format';
import { scoreColor, gradeLabel } from '../lib/model';

/**
 * PerformanceScoreCard — the 0-100 endpoint performance score as a 270° SVG arc
 * gauge (AI PREVENTION deep dive). The arc fills to the score and takes the same
 * green≥85 / orange≥70 / amber≥50 / red band color the EarlyWarning list uses;
 * the center reads the number + grade, and a sub-row breaks out the p95 latency
 * and error rate that drove it. Reduced-motion safe (the arc's grow transition
 * drops under `motion-reduce`). Presentational — the parent owns the polling.
 */

// Gauge geometry: a 270° sweep with the gap centered at the bottom.
const SIZE = 150;
const STROKE = 12;
const R = (SIZE - STROKE) / 2 - 4;
const CENTER = SIZE / 2;
const CIRC = 2 * Math.PI * R;
const SWEEP = 0.75; // 270° of the full 360°
const TRACK_LEN = CIRC * SWEEP;
// Rotate so the arc starts at the lower-left (135°) and sweeps clockwise 270°.
const ROTATE = 135;

export function PerformanceScoreCard({ endpoint: e }: { endpoint: EndpointPerformance }) {
  const score = Math.max(0, Math.min(100, Math.round(e.score.overall_score)));
  const color = scoreColor(score);
  const valueLen = TRACK_LEN * (score / 100);

  return (
    <GlassCard className="flex flex-col p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
          style={{ color, borderColor: color + '55', backgroundColor: color + '1f' }}
        >
          <Gauge className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <span
            className="block text-[10px] uppercase tracking-[0.2em] text-white/45"
            style={{ fontFamily: MONO }}
          >
            Performance Score
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

      {/* Gauge */}
      <div className="mt-2 flex flex-1 items-center justify-center">
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            role="meter"
            aria-valuenow={score}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${e.service} ${e.endpoint} performance score ${score} of 100`}
          >
            {/* Track */}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={R}
              fill="none"
              stroke="rgba(255,255,255,0.09)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${TRACK_LEN} ${CIRC}`}
              transform={`rotate(${ROTATE} ${CENTER} ${CENTER})`}
            />
            {/* Value arc */}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={R}
              fill="none"
              stroke={color}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${valueLen} ${CIRC}`}
              transform={`rotate(${ROTATE} ${CENTER} ${CENTER})`}
              className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
              style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
            />
          </svg>
          {/* Center read-out */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span
              className="text-[34px] font-bold leading-none tabular-nums"
              style={{ color }}
            >
              {score}
            </span>
            <span className="mt-0.5 text-[10px] text-white/40" style={{ fontFamily: MONO }}>
              / 100
            </span>
            <span
              className="mt-1.5 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]"
              style={{
                fontFamily: MONO,
                color,
                borderColor: color + '55',
                backgroundColor: color + '1f',
              }}
            >
              {gradeLabel(e.score.grade)}
            </span>
          </div>
        </div>
      </div>

      {/* Signal sub-row */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SubStat label="p95 latency" value={ms(e.p95)} />
        <SubStat label="error rate" value={pct(e.errorRate)} tone={e.errorRate > 0 ? RED_TEXT : undefined} />
      </div>
    </GlassCard>
  );
}

const RED_TEXT = '#FF6B5C';

function SubStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <span
        className="block text-[9px] uppercase tracking-[0.16em] text-white/40"
        style={{ fontFamily: MONO }}
      >
        {label}
      </span>
      <span
        className="mt-0.5 block text-sm font-semibold tabular-nums text-white"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
