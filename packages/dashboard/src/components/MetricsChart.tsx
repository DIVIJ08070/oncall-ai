import {
  ResponsiveContainer,
  AreaChart,
  Area,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import type { MetricsSnapshot } from '@oncall/shared';
import { getMetrics } from '../api';
import { usePolling } from '../hooks/usePolling';
import { useReducedMotion } from '../hooks/useMediaQuery';
import {
  POLL_INTERVAL_MS,
  ERROR_RATE_THRESHOLD,
  LATENCY_P95_THRESHOLD_MS,
} from '../config';
import { pct, ms, clockHm, relativeTime } from '../lib/format';
import { v } from '../lib/tokens';
import { Card, CardHeader } from './primitives/Card';
import { EmptyState } from './primitives/EmptyState';
import { Skeleton } from './primitives/Skeleton';
import { Button } from './primitives/Button';
import { Icon } from './primitives/Icon';

export type MetricVariant = 'error' | 'latency';

const CHART_MARGIN = { top: 8, right: 12, bottom: 4, left: 4 };
const TICK = { fill: 'var(--ink-muted-text)', fontSize: 11 };

/**
 * MetricsChart (DESIGN_SPEC §8.3 + §9). Two variants, each its own single-y-axis
 * card, both fed by `GET /metrics` (polled every 5s):
 *  - `error`  → AreaChart, error-rate line + 10% wash, critical threshold line, breach dots.
 *  - `latency`→ ComposedChart, p50–p99 aqua band + p95 line (direct end-label) + warn SLO line.
 * States: loading / empty / error / live (§9.4). A collapsible data-table + a
 * descriptive aria-label provide the accessibility fallback.
 */
export function MetricsChart({
  service,
  windowSec,
  variant,
  height = 220,
}: {
  service: string | null;
  windowSec: number;
  variant: MetricVariant;
  height?: number;
}) {
  const reduceMotion = useReducedMotion();

  const { data, error, loading, updatedAt, refetch } = usePolling<MetricsSnapshot>(
    (signal) => getMetrics({ service: service!, window_sec: windowSec }, signal),
    [service, windowSec],
    { intervalMs: POLL_INTERVAL_MS, enabled: Boolean(service) },
  );

  const title = variant === 'error' ? 'Error rate' : 'Latency (p95)';
  const series = data?.series ?? [];
  const current = data?.current;

  const currentValue =
    variant === 'error'
      ? current
        ? pct(current.error_rate)
        : '—'
      : current
        ? ms(current.p95_ms)
        : '—';
  const breached =
    variant === 'error'
      ? (current?.error_rate ?? 0) >= ERROR_RATE_THRESHOLD
      : (current?.p95_ms ?? 0) >= LATENCY_P95_THRESHOLD_MS;

  const ariaLabel =
    variant === 'error'
      ? `Error rate over the selected window${current ? `, currently ${pct(current.error_rate)}` : ''}, threshold ${pct(ERROR_RATE_THRESHOLD, 0)}`
      : `p95 latency over the selected window${current ? `, currently ${ms(current.p95_ms)}` : ''}, SLO ${LATENCY_P95_THRESHOLD_MS}ms`;

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={title}
        right={
          <div className="flex items-center gap-3">
            <span
              className="tabular text-h3 font-semibold"
              style={{ color: breached ? v(variant === 'error' ? 'critical' : 'warn') : v('ink') }}
            >
              {currentValue}
            </span>
            {updatedAt && !loading ? (
              <span className="hidden text-sm text-ink-muted-text sm:inline">
                updated {relativeTime(updatedAt)}
              </span>
            ) : null}
          </div>
        }
      />

      <div style={{ height }} aria-label={ariaLabel} role="img">
        {!service ? (
          <ChartMessage>Select a service to see metrics</ChartMessage>
        ) : loading ? (
          <ChartSkeleton height={height} />
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-ink-2">
            <span className="text-ink-muted-text">
              <Icon icon={AlertTriangle} size={20} />
            </span>
            Couldn&apos;t load metrics — {error.message}
            <Button variant="ghost" onClick={refetch}>
              Retry
            </Button>
          </div>
        ) : series.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="No data yet for this window"
            subtitle="Metrics populate once the service is sending traffic."
            className="h-full justify-center"
          />
        ) : variant === 'error' ? (
          <ErrorRateChart series={series} animate={!reduceMotion} />
        ) : (
          <LatencyChart series={series} animate={!reduceMotion} />
        )}
      </div>

      {series.length > 0 && <DataTable series={series} variant={variant} />}
    </Card>
  );
}

/* ── Error-rate chart (§9.1) ─────────────────────────────────────────────── */

function ErrorRateChart({
  series,
  animate,
}: {
  series: MetricsSnapshot['series'];
  animate: boolean;
}) {
  const dataMax = Math.max(...series.map((p) => p.error_rate), 0);
  const yMax = Math.max(0.25, dataMax * 1.2);
  const data = series.map((p) => ({ ts: p.ts, error_rate: p.error_rate }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={CHART_MARGIN}>
        <defs>
          <linearGradient id="err-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-error)" stopOpacity={0.1} />
            <stop offset="100%" stopColor="var(--series-error)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid horizontal vertical={false} stroke="var(--grid)" strokeWidth={1} />
        <XAxis
          dataKey="ts"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={clockHm}
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: 'var(--axis)' }}
          minTickGap={44}
        />
        <YAxis
          domain={[0, yMax]}
          tickFormatter={(x: number) => `${Math.round(x * 100)}%`}
          tick={TICK}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          content={<MetricsTooltip rows={[{ key: 'error_rate', label: 'Error rate', token: 'series-error', fmt: (x) => pct(x) }]} />}
          cursor={{ stroke: 'var(--axis)' }}
        />
        <ReferenceLine
          y={ERROR_RATE_THRESHOLD}
          stroke="var(--critical)"
          strokeOpacity={0.7}
          strokeDasharray="4 4"
          label={{ value: 'threshold 20%', position: 'insideTopRight', fill: 'var(--ink-muted-text)', fontSize: 11 }}
        />
        <Area
          type="monotone"
          dataKey="error_rate"
          stroke="var(--series-error)"
          strokeWidth={2}
          fill="url(#err-fill)"
          isAnimationActive={animate}
          animationDuration={150}
          dot={<BreachDot />}
          activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--series-error)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Render a `--critical` dot only at points that breach the error-rate threshold.
 * Recharts' `<Area>` passes the dot `value` as a `[baseline, y]` range tuple, so a
 * scalar `value < threshold` guard is a NaN comparison that never hides the dot
 * (BUG-010). Gate on the real datum (`payload.error_rate`) instead — §9.1.
 */
function BreachDot(props: {
  cx?: number;
  cy?: number;
  payload?: { error_rate?: number };
  index?: number;
}) {
  const { cx, cy, payload } = props;
  const errorRate = payload?.error_rate;
  if (cx == null || cy == null || errorRate == null || errorRate < ERROR_RATE_THRESHOLD) {
    return <g />;
  }
  return (
    <circle cx={cx} cy={cy} r={4} fill="var(--critical)" stroke="var(--surface)" strokeWidth={2} />
  );
}

/* ── Latency chart (§9.2) ────────────────────────────────────────────────── */

function LatencyChart({
  series,
  animate,
}: {
  series: MetricsSnapshot['series'];
  animate: boolean;
}) {
  const dataMax = Math.max(...series.map((p) => p.p99_ms), 0);
  const yMax = Math.max(1200, dataMax * 1.2);
  const data = series.map((p) => ({
    ts: p.ts,
    p50_ms: p.p50_ms,
    p95_ms: p.p95_ms,
    p99_ms: p.p99_ms,
    band: [p.p50_ms, p.p99_ms] as [number, number],
  }));
  const lastIndex = data.length - 1;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid horizontal vertical={false} stroke="var(--grid)" strokeWidth={1} />
        <XAxis
          dataKey="ts"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={clockHm}
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: 'var(--axis)' }}
          minTickGap={44}
        />
        <YAxis
          domain={[0, yMax]}
          tickFormatter={(x: number) => `${Math.round(x)}`}
          tick={TICK}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          content={
            <MetricsTooltip
              rows={[
                { key: 'p50_ms', label: 'p50', token: 'series-lat', fmt: (x) => ms(x) },
                { key: 'p95_ms', label: 'p95', token: 'series-lat', fmt: (x) => ms(x) },
                { key: 'p99_ms', label: 'p99', token: 'series-lat', fmt: (x) => ms(x) },
              ]}
            />
          }
          cursor={{ stroke: 'var(--axis)' }}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={20}
          iconType="plainline"
          wrapperStyle={{ fontSize: 11, color: 'var(--ink-muted-text)' }}
        />
        <ReferenceLine
          y={LATENCY_P95_THRESHOLD_MS}
          stroke="var(--warn)"
          strokeOpacity={0.7}
          strokeDasharray="4 4"
          label={{ value: 'p95 SLO 1000ms', position: 'insideTopRight', fill: 'var(--ink-muted-text)', fontSize: 11 }}
        />
        {/* p50–p99 band */}
        <Area
          dataKey="band"
          stroke="none"
          fill="var(--series-lat-band)"
          isAnimationActive={animate}
          animationDuration={150}
          legendType="none"
          activeDot={false}
          name="p50–p99"
        />
        {/* Legend keys for p50/p99 (identity carried by band + direct p95 label). */}
        <Line dataKey="p50_ms" stroke="var(--series-lat)" strokeOpacity={0.35} strokeWidth={1} dot={false} name="p50" isAnimationActive={false} />
        <Line dataKey="p99_ms" stroke="var(--series-lat)" strokeOpacity={0.35} strokeWidth={1} dot={false} name="p99" isAnimationActive={false} />
        {/* Primary p95 line + direct end-label */}
        <Line
          type="monotone"
          dataKey="p95_ms"
          name="p95"
          stroke="var(--series-lat)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={animate}
          animationDuration={150}
          activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--series-lat)' }}
          label={(p: { x?: number; y?: number; index?: number }) =>
            p.index === lastIndex && p.x != null && p.y != null ? (
              <text
                key="p95-end"
                x={p.x + 6}
                y={p.y}
                dy={4}
                fontSize={11}
                fontWeight={600}
                fill="var(--series-lat)"
              >
                p95
              </text>
            ) : (
              <g key={`e${p.index}`} />
            )
          }
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── Shared tooltip / states / a11y table ────────────────────────────────── */

interface TooltipRow {
  key: string;
  label: string;
  token: string;
  fmt: (x: number) => string;
}

function MetricsTooltip({
  active,
  payload,
  label,
  rows,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, number> }>;
  label?: number;
  rows: TooltipRow[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm shadow-elev-2">
      <div className="mb-1 tabular text-ink-muted-text">
        {label != null ? clockHm(label) : ''}
      </div>
      <div className="flex flex-col gap-0.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: v(r.token) }} />
              {r.label}
            </span>
            <span className="tabular text-ink">{r.fmt(point[r.key])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div className="flex h-full flex-col justify-end gap-2 px-2 pb-6 pt-2" style={{ height }}>
      <div className="flex flex-1 items-end gap-1.5">
        {Array.from({ length: 16 }).map((_, i) => (
          <Skeleton key={i} className="flex-1" style={{ height: `${20 + ((i * 37) % 70)}%` }} />
        ))}
      </div>
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

function ChartMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-ink-muted-text">
      {children}
    </div>
  );
}

/** Collapsible data-table fallback (dataviz "table view exists" rule, §9.4). */
function DataTable({
  series,
  variant,
}: {
  series: MetricsSnapshot['series'];
  variant: MetricVariant;
}) {
  return (
    <details className="mt-3 border-t border-border pt-2">
      <summary className="cursor-pointer text-sm text-ink-muted-text">Data table</summary>
      <div className="mt-2 max-h-48 overflow-auto">
        <table className="tabular w-full text-mono-sm text-ink-2">
          <thead className="text-ink-muted-text">
            <tr>
              <th className="p-1 text-left font-medium">time</th>
              {variant === 'error' ? (
                <th className="p-1 text-right font-medium">error rate</th>
              ) : (
                <>
                  <th className="p-1 text-right font-medium">p50</th>
                  <th className="p-1 text-right font-medium">p95</th>
                  <th className="p-1 text-right font-medium">p99</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {series.map((p) => (
              <tr key={p.ts}>
                <td className="p-1">{clockHm(p.ts)}</td>
                {variant === 'error' ? (
                  <td className="p-1 text-right">{pct(p.error_rate)}</td>
                ) : (
                  <>
                    <td className="p-1 text-right">{p.p50_ms}</td>
                    <td className="p-1 text-right">{p.p95_ms}</td>
                    <td className="p-1 text-right">{p.p99_ms}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
