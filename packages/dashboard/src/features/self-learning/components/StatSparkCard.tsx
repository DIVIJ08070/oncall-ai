import type { LucideIcon } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { GlassCard, MONO } from '../../../components/shell/UnifiedChrome';

/**
 * StatSparkCard — one left-rail stat for the Self-Learning command center:
 * tiny mono label + tinted icon square, big number, a delta line, and a 40px
 * axis-less sparkline. Pure presentational; the page computes value/series.
 */

export interface StatSparkCardProps {
  label: string;
  icon: LucideIcon;
  /** Pre-formatted headline value ("92%", "5"). */
  value: string;
  /** One-line delta/caption under the number. */
  delta: string;
  /** Color of the delta line (defaults to muted white). */
  deltaColor?: string;
  /** Accent for icon square + sparkline stroke. */
  color: string;
  /** Cumulative series; flat zeros when there is no data yet. */
  series: number[];
}

export function StatSparkCard({
  label,
  icon: IconCmp,
  value,
  delta,
  deltaColor,
  color,
  series,
}: StatSparkCardProps) {
  const data = series.map((v, i) => ({ i, v }));
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span
          className="truncate text-[10px] uppercase tracking-[0.18em] text-white/40"
          style={{ fontFamily: MONO }}
        >
          {label}
        </span>
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}1F`, color }}
        >
          <IconCmp className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="mt-2 text-[26px] font-bold leading-none tracking-tight text-[#F5F5F2] tabular-nums">
        {value}
      </div>
      <div
        className="mt-1.5 truncate text-[11px]"
        style={{ color: deltaColor ?? 'rgba(255,255,255,0.4)' }}
      >
        {delta}
      </div>
      <div className="mt-2 h-10" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
            <Line
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}
