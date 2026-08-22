import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getPerformance } from '../../../api/performance';
import { usePolling } from '../../../hooks/usePolling';
import { GlassCard, MONO } from '../../../components/shell/UnifiedChrome';
import { PerformanceScoreCard } from './PerformanceScoreCard';
import { TrendPredictionCard } from './TrendPredictionCard';
import { focusEndpoint, endpointKey } from '../lib/model';

/**
 * PreventionSpotlight — the AI PREVENTION "deep dive" section that sits beside the
 * EarlyWarning list on the dashboard. Polls `GET /api/v1/performance` (5s), picks
 * the single most at-risk endpoint, and renders its live score gauge + breach
 * forecast side by side. Score history for the sparkline is accumulated across
 * polls (there is no server history route), keyed by endpoint so it survives the
 * focus moving between endpoints as risk shifts.
 */

const POLL_MS = 5_000;
const HISTORY_CAP = 30;

export function PreventionSpotlight() {
  const { data, error, loading } = usePolling((signal) => getPerformance(signal), [], {
    intervalMs: POLL_MS,
  });

  const endpoints = useMemo(() => data?.endpoints ?? [], [data]);
  const focus = useMemo(() => focusEndpoint(endpoints), [endpoints]);

  // Rolling per-endpoint score history for the sparkline, grown one point per poll.
  const [histories, setHistories] = useState<Record<string, number[]>>({});
  const lastWindowRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!focus) return;
    const key = endpointKey(focus);
    // Only append when this is a genuinely newer window for the endpoint, so
    // re-renders between polls don't duplicate the last point.
    if (lastWindowRef.current[key] === focus.windowEnd) return;
    lastWindowRef.current[key] = focus.windowEnd;
    setHistories((prev) => {
      const next = [...(prev[key] ?? []), focus.score.overall_score].slice(-HISTORY_CAP);
      return { ...prev, [key]: next };
    });
  }, [focus]);

  // First paint (before any data): two glass skeletons.
  if (loading && endpoints.length === 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <GlassCard key={i} className="h-[300px] p-5">
            <div className="h-full w-full rounded-xl bg-white/[0.03] motion-safe:animate-pulse" />
          </GlassCard>
        ))}
      </div>
    );
  }

  if (error && endpoints.length === 0) {
    return (
      <GlassCard className="flex items-center gap-3 p-4 sm:p-5">
        <AlertTriangle className="h-5 w-5 shrink-0 text-[#FF8233]" />
        <p className="text-[11px] leading-relaxed text-white/50" style={{ fontFamily: MONO }}>
          Couldn&rsquo;t load endpoint performance — {error.message}
        </p>
      </GlassCard>
    );
  }

  if (!focus) {
    return (
      <GlassCard className="p-4 sm:p-5">
        <p className="text-[11px] leading-relaxed text-white/40" style={{ fontFamily: MONO }}>
          No endpoint samples yet — the deep dive appears once traffic is scored.
        </p>
      </GlassCard>
    );
  }

  const history = histories[endpointKey(focus)] ?? [];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <PerformanceScoreCard endpoint={focus} />
      <TrendPredictionCard endpoint={focus} history={history} />
    </div>
  );
}
