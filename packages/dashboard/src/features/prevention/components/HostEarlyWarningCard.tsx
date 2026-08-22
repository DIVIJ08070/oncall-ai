import { useMemo } from 'react';
import { Activity, Cpu, Database, Gauge, MemoryStick, ShieldCheck, Timer, TrendingUp, Wrench } from 'lucide-react';
import type {
  EndpointPerformance,
  HostEarlyWarningMetric,
  HostMetricName,
} from '@oncall/shared';
import { getHostEarlyWarning } from '../../../api/host';
import { getPerformance } from '../../../api/performance';
import { usePolling } from '../../../hooks/usePolling';
import { GlassCard, MONO } from '../../../components/shell/UnifiedChrome';
import { relativeTime } from '../../../lib/format';
import { GREEN, AMBER, RED, STATUS_COLOR, STATUS_LABEL, RISK_RANK } from '../lib/model';

/**
 * HostEarlyWarningCard — the mockup's "AI EARLY WARNING" card (AI Incident
 * PREVENTION, HOST layer). Polls `GET /api/v1/host-early-warning` every 5s, picks
 * the single most at-risk service, and renders its resource gauges as ██████░░
 * block bars — CPU / Memory / DB Pool (host metrics) + Latency (worst endpoint p95
 * from `GET /api/v1/performance`) — coloured green<70 / amber<85 / red≥85. Below
 * the bars it leads with the headline prediction ("… may become unavailable"), the
 * breach probability, the likely cause, and the recommended action ("Increase
 * connection pool 100→150"). Reduced-motion safe.
 */

const POLL_MS = 5_000;
const N_BLOCKS = 12;
/** Latency SLO ceiling (ms) the p95 bar fills toward — p95 ≥ this reads 100%. */
const LATENCY_SLO_MS = 500;

const METRIC_LABEL: Record<HostMetricName, string> = {
  cpu: 'CPU',
  mem: 'Memory',
  db_pool: 'DB Pool',
};

const METRIC_ICON: Record<HostMetricName | 'latency', typeof Cpu> = {
  cpu: Cpu,
  mem: MemoryStick,
  db_pool: Database,
  latency: Timer,
};

/** Bar band colour keyed to a 0-100 utilisation/pressure fill. */
function barColor(value: number): string {
  if (value >= 85) return RED;
  if (value >= 70) return AMBER;
  return GREEN;
}

/** Worst-metric ranking within a service: status, then probability, then fill. */
function metricRank(m: HostEarlyWarningMetric): number {
  return RISK_RANK[m.status] * 1e6 + m.probability * 1e3 + m.bars;
}

/** The plain-language consequence if the worst metric keeps climbing. */
function consequence(metric: HostMetricName): string {
  switch (metric) {
    case 'db_pool':
      return 'may become unavailable';
    case 'mem':
      return 'may crash (out of memory)';
    case 'cpu':
      return 'may slow down (CPU saturating)';
  }
}

/** Headline prediction sentence — service + consequence, with a breach ETA. */
function predictionSentence(m: HostEarlyWarningMetric): string {
  const base = `${m.service} ${consequence(m.metric)}`;
  if (m.status === 'BREACHED' || m.status === 'ESCALATED') return base;
  if (m.minutesToBreach != null && m.minutesToBreach > 0) {
    return `${base} in ~${Math.max(1, Math.round(m.minutesToBreach))} min`;
  }
  return base;
}

interface BarRow {
  key: string;
  label: string;
  icon: typeof Cpu;
  /** 0-100 fill driving the blocks + colour. */
  fill: number;
  /** Right-aligned read-out (e.g. "94%" or "213ms"). */
  readout: string;
}

/** Rank services by their single worst host metric so the card leads with it. */
function focusService(
  metrics: readonly HostEarlyWarningMetric[],
): { service: string; metrics: HostEarlyWarningMetric[]; worst: HostEarlyWarningMetric } | null {
  if (metrics.length === 0) return null;
  const byService = new Map<string, HostEarlyWarningMetric[]>();
  for (const m of metrics) {
    const list = byService.get(m.service) ?? [];
    list.push(m);
    byService.set(m.service, list);
  }
  let best: { service: string; metrics: HostEarlyWarningMetric[]; worst: HostEarlyWarningMetric } | null = null;
  for (const [service, list] of byService) {
    const worst = [...list].sort((a, b) => metricRank(b) - metricRank(a))[0];
    if (best == null || metricRank(worst) > metricRank(best.worst)) {
      best = { service, metrics: list, worst };
    }
  }
  return best;
}

/** Worst p95 across the focus service's endpoints (null when none scored yet). */
function servicePeakP95(
  service: string,
  endpoints: readonly EndpointPerformance[],
): number | null {
  const mine = endpoints.filter((e) => e.service === service);
  if (mine.length === 0) return null;
  return mine.reduce((peak, e) => Math.max(peak, e.p95), 0);
}

export function HostEarlyWarningCard() {
  const { data: host, error, loading, updatedAt } = usePolling(
    (signal) => getHostEarlyWarning(signal),
    [],
    { intervalMs: POLL_MS },
  );
  // Latency is a per-endpoint signal; fold the focus service's worst p95 in as the
  // 4th bar so the card matches the mockup's CPU/Memory/DB-Pool/Latency gauges.
  const { data: perf } = usePolling(
    (signal) => getPerformance(signal),
    [],
    { intervalMs: POLL_MS },
  );

  const metrics = useMemo(() => host?.metrics ?? [], [host]);
  const focus = useMemo(() => focusService(metrics), [metrics]);

  const rows = useMemo<BarRow[]>(() => {
    if (focus == null) return [];
    const order: HostMetricName[] = ['cpu', 'mem', 'db_pool'];
    const out: BarRow[] = [];
    for (const name of order) {
      const m = focus.metrics.find((x) => x.metric === name);
      out.push({
        key: name,
        label: METRIC_LABEL[name],
        icon: METRIC_ICON[name],
        fill: m ? Math.max(0, Math.min(100, m.bars)) : 0,
        readout: m ? `${Math.round(m.current)}%` : '—',
      });
    }
    const p95 = servicePeakP95(focus.service, perf?.endpoints ?? []);
    out.push({
      key: 'latency',
      label: 'Latency',
      icon: METRIC_ICON.latency,
      fill: p95 == null ? 0 : Math.max(0, Math.min(100, (p95 / LATENCY_SLO_MS) * 100)),
      readout: p95 == null ? '—' : `${Math.round(p95)}ms`,
    });
    return out;
  }, [focus, perf]);

  const worst = focus?.worst ?? null;
  const atRisk = worst != null && worst.status !== 'NORMAL' && worst.status !== 'RECOVERED';
  const headColor: string = atRisk && worst ? STATUS_COLOR[worst.status] : GREEN;

  return (
    <GlassCard className="p-4 sm:p-5">
      {/* Header — title + live status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg border"
            style={{ color: headColor, borderColor: headColor + '55', backgroundColor: headColor + '1f' }}
          >
            {atRisk ? <Activity className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          </span>
          <div>
            <span
              className="block text-[10px] uppercase tracking-[0.24em] text-white/45"
              style={{ fontFamily: MONO }}
            >
              AI Early Warning
            </span>
            <span className="block text-sm font-semibold text-white">
              {focus ? (
                <>
                  Host resources
                  <span className="text-white/35"> · </span>
                  <span style={{ fontFamily: MONO }} className="text-white/70">{focus.service}</span>
                </>
              ) : (
                'Host resource forecast'
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {worst && (
            <span
              className="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]"
              style={{ fontFamily: MONO, color: headColor, borderColor: headColor + '55', backgroundColor: headColor + '1f' }}
            >
              {STATUS_LABEL[worst.status]}
            </span>
          )}
          {!error && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#52D273] motion-safe:animate-pulse-live" />
              <span
                className="text-[10px] uppercase tracking-[0.16em] text-white/45 tabular-nums"
                style={{ fontFamily: MONO }}
              >
                {loading && metrics.length === 0 ? 'scanning' : 'monitoring'}
                {updatedAt != null && ` · ${relativeTime(updatedAt)}`}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="mt-4">
        {error && metrics.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-white/45" style={{ fontFamily: MONO }}>
            Couldn&rsquo;t reach the host monitor — {error.message}
          </p>
        ) : loading && metrics.length === 0 ? (
          <ul className="flex flex-col gap-2.5" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="h-6 rounded-lg border border-white/5 bg-white/[0.03] motion-safe:animate-pulse" />
            ))}
          </ul>
        ) : focus == null ? (
          <p className="text-[11px] leading-relaxed text-white/40" style={{ fontFamily: MONO }}>
            No host samples yet — the ticker fills in as metrics stream.
          </p>
        ) : (
          <>
            {/* ██████░░ block bars — CPU / Memory / DB Pool / Latency */}
            <div className="flex flex-col gap-2">
              {rows.map((row) => (
                <BlockBar key={row.key} row={row} />
              ))}
            </div>

            {/* Prediction panel — the consequence sentence, likely cause and
                recommended action are RISK context: rendering them while every
                metric is healthy reads as a live warning at "0%", which is
                nonsense. Healthy ⇒ a calm all-clear line instead. */}
            {worst && atRisk ? (
              <div
                className="mt-4 rounded-xl border px-3.5 py-3"
                style={{ borderColor: headColor + '55', backgroundColor: headColor + '12' }}
              >
                <div className="flex items-start gap-2.5">
                  <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" style={{ color: headColor }} />
                  <div className="min-w-0">
                    <span
                      className="block text-[9px] uppercase tracking-[0.2em] text-white/45"
                      style={{ fontFamily: MONO }}
                    >
                      Prediction
                    </span>
                    <span className="block text-sm font-bold leading-snug" style={{ color: headColor }}>
                      {predictionSentence(worst)}
                    </span>
                  </div>
                  <span className="ml-auto shrink-0 text-right">
                    <span
                      className="block text-[9px] uppercase tracking-[0.16em] text-white/40"
                      style={{ fontFamily: MONO }}
                    >
                      Probability
                    </span>
                    <span className="block text-lg font-bold tabular-nums" style={{ color: headColor }}>
                      {Math.round(worst.probability * 100)}%
                    </span>
                  </span>
                </div>

                <dl className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
                  <div className="flex items-start gap-2">
                    <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" />
                    <dt className="sr-only">Likely cause</dt>
                    <dd className="text-xs leading-relaxed text-white/70">
                      <span className="text-white/40" style={{ fontFamily: MONO }}>Likely cause · </span>
                      {worst.likelyCause}
                    </dd>
                  </div>
                  <div className="flex items-start gap-2">
                    <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: GREEN }} />
                    <dt className="sr-only">Recommended action</dt>
                    <dd className="text-xs font-medium leading-relaxed text-white/85">
                      <span className="text-white/40" style={{ fontFamily: MONO }}>Recommended · </span>
                      {worst.recommendedAction}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : worst ? (
              <div
                className="mt-4 flex items-center gap-2.5 rounded-xl border px-3.5 py-3"
                style={{ borderColor: GREEN + '35', backgroundColor: GREEN + '10' }}
              >
                <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: GREEN }} />
                <div className="min-w-0">
                  <span
                    className="block text-[9px] uppercase tracking-[0.2em] text-white/45"
                    style={{ fontFamily: MONO }}
                  >
                    Prediction
                  </span>
                  <span className="block text-sm font-semibold leading-snug" style={{ color: GREEN }}>
                    No breach predicted — {focus?.service ?? 'host'} resources healthy
                  </span>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </GlassCard>
  );
}

/** One ██████░░ resource gauge row: icon + label, block bar, right-aligned read-out. */
function BlockBar({ row }: { row: BarRow }) {
  const Icon = row.icon;
  const color = barColor(row.fill);
  const filled = Math.max(0, Math.min(N_BLOCKS, Math.round((row.fill / 100) * N_BLOCKS)));
  const empty = N_BLOCKS - filled;

  return (
    <div className="flex items-center gap-3">
      <span className="flex w-[86px] shrink-0 items-center gap-1.5 text-[11px] text-white/60">
        <Icon className="h-3.5 w-3.5 shrink-0 text-white/40" />
        {row.label}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-sm leading-none"
        style={{ fontFamily: MONO }}
        role="meter"
        aria-valuenow={Math.round(row.fill)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${row.label} ${Math.round(row.fill)} percent`}
      >
        <span style={{ color }}>{'█'.repeat(filled)}</span>
        <span className="text-white/12">{'░'.repeat(empty)}</span>
      </span>
      <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums" style={{ color }}>
        {row.readout}
      </span>
    </div>
  );
}
