import { MONO } from '../../../components/shell/UnifiedChrome';

/**
 * ScoreRing — SVG donut for the report hero. Track + colored arc (green ≥80,
 * orange ≥60, red below), the grade letter centered with the numeric score
 * underneath. Purely presentational.
 */

const GREEN = '#52D273';
const ORANGE = '#F16524';
const RED = '#FF3B30';

export function scoreColor(score: number): string {
  if (score >= 80) return GREEN;
  if (score >= 60) return ORANGE;
  return RED;
}

export function ScoreRing({
  score,
  grade,
  size = 176,
}: {
  score: number;
  grade: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const color = scoreColor(clamped);
  const stroke = size * 0.075;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (clamped / 100) * c;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Health score ${clamped} out of 100, grade ${grade}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        {/* value arc — starts at 12 o'clock */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 700ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-5xl font-bold leading-none"
          style={{ color, fontFamily: "'Playfair Display', serif" }}
        >
          {grade}
        </span>
        <span
          className="mt-1.5 text-[11px] tabular-nums text-white/50"
          style={{ fontFamily: MONO }}
        >
          {clamped}/100
        </span>
      </div>
    </div>
  );
}
