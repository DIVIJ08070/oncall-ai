import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Brain,
  Clock,
  CreditCard,
  Database,
  Globe,
  Layers,
  Server,
  Shield,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { IncidentSummary, Severity } from '@oncall/shared';
import { getIncidents } from '../../api';
import { relativeTime } from '../../lib/format';
import { Grain } from '../atmosphere';
import { AnimatedNumber, Entrance, StaggerGroup, StaggerItem } from '../motion/primitives';
import { TerrainNetwork } from './TerrainNetwork';
import {
  UnifiedSidebar,
  UnifiedTopBar,
  GlassCard,
  MONO,
} from '../shell/UnifiedChrome';

/**
 * Futuristic product-shell home (`/`) — a dark landing that mimics the console:
 * floating glass sidebar, hero copy over the live TerrainNetwork canvas (glowing
 * network-terrain that reacts to the cursor), floating service-status chips,
 * a stat-tile row, and Recent Incidents + AI Insights cards.
 *
 * Brand-fixed dark surface (like SpotlightHero): raw brand hex on purpose, not
 * theme tokens. `SpotlightHero.tsx` stays on disk as the revert path.
 */



/* ── shared nav data ──────────────────────────────────────────────────────── */

/* ── page ─────────────────────────────────────────────────────────────────── */

export function FuturisticHome() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#050505] text-[#F5F5F2]">
      {/* faint warm radial glow, top-center */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[72vh]"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 0%, rgba(241,101,36,0.10), rgba(109,74,255,0.05) 45%, transparent 75%)',
        }}
      />
      <Grain opacity={0.12} />

      <div className="relative flex w-full items-start gap-6 p-4 sm:p-6">
        <UnifiedSidebar />

        <main className="min-w-0 flex-1">
          <Entrance y={8}>
            <UnifiedTopBar />
          </Entrance>

          <Hero />
          <StatsRow />

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Entrance delay={0.3}>
              <RecentIncidentsCard />
            </Entrance>
            <Entrance delay={0.38}>
              <AiInsightsCard />
            </Entrance>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ── hero + floating service chips ────────────────────────────────────────── */

type ChipStatus = 'healthy' | 'warning' | 'critical';

const CHIP_STATUS: Record<ChipStatus, { label: string; color: string }> = {
  healthy: { label: 'Healthy', color: '#52D273' },
  warning: { label: 'Warning', color: '#FF8233' },
  critical: { label: 'Critical', color: '#FF3B30' },
};

/** `lgOnly` chips disappear below lg — small screens keep three. */
const SERVICE_CHIPS: {
  name: string;
  status: ChipStatus;
  icon: LucideIcon;
  top: string;
  right: string;
  dur: number;
  delay: number;
  lgOnly?: boolean;
  detail: [string, string][]; // hover tooltip rows: [label, value]
  note: string;
  /** where this service LIVES on the mountain (panel fractions) */
  ax: number;
  ay: number;
}[] = [
  {
    name: 'Auth Service', status: 'healthy', icon: Shield, top: '13%', right: '26%', dur: 7, delay: 0,
    detail: [['p95 latency', '41ms'], ['error rate', '0.00%'], ['req/min', '2.4k']],
    note: 'No incidents in 30 days.',
    ax: 0.42,
    ay: 0.47,
  },
  {
    name: 'Payment Gateway', status: 'warning', icon: CreditCard, top: '38%', right: '7%', dur: 8.2, delay: 1.4,
    detail: [['p95 latency', '380ms ↑'], ['error rate', '2.1%'], ['req/min', '860']],
    note: 'Latency rising — AI is watching.',
    ax: 0.74,
    ay: 0.33,
  },
  {
    name: 'User Service', status: 'healthy', icon: Users, top: '24%', right: '5%', dur: 6.4, delay: 2.2, lgOnly: true,
    detail: [['p95 latency', '62ms'], ['error rate', '0.01%'], ['req/min', '1.1k']],
    note: 'Steady all week.',
    ax: 0.6,
    ay: 0.38,
  },
  {
    name: 'Database', status: 'healthy', icon: Database, top: '70%', right: '33%', dur: 9, delay: 0.8, lgOnly: true,
    detail: [['p95 query', '12ms'], ['connections', '42 / 100'], ['replication lag', '0.3s']],
    note: 'Pool healthy, no slow queries.',
    ax: 0.55,
    ay: 0.63,
  },
  {
    name: 'Cache Layer', status: 'critical', icon: Layers, top: '62%', right: '18%', dur: 6, delay: 1.8,
    detail: [['hit rate', '61% ↓'], ['evictions/min', '4.2k ↑'], ['memory', '97%']],
    note: 'Incident open — AI investigating a fix.',
    ax: 0.8,
    ay: 0.46,
  },
  {
    name: 'API Gateway', status: 'warning', icon: Globe, top: '82%', right: '8%', dur: 8.6, delay: 2.8, lgOnly: true,
    detail: [['5xx rate', '1.8% ↑'], ['p95 latency', '210ms'], ['req/min', '5.9k']],
    note: 'Correlated with deploy v2.14.3.',
    ax: 0.88,
    ay: 0.62,
  },
];

function Hero() {
  return (
    <section className="relative min-h-[calc(100vh-150px)] overflow-hidden rounded-3xl border border-white/10 bg-[#070608]">
      <TerrainNetwork className="absolute inset-0" />

      {/* floating service chips — decorative, cursor passes through to the terrain */}
      {/* leader lines: every chip is PINNED to its territory on the mountain —
          the glowing routes below are the dependencies between those pins */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[9] hidden h-full w-full lg:block"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {SERVICE_CHIPS.map(({ name, status, top, right, ax, ay }) => {
          const meta = CHIP_STATUS[status];
          const cx = 100 - parseFloat(right) - 7; // approx chip bottom-centre
          const cy = parseFloat(top) + 6;
          return (
            <g key={name}>
              <line
                x1={cx}
                y1={cy}
                x2={ax * 100}
                y2={ay * 100}
                stroke={meta.color}
                strokeOpacity={0.45}
                strokeDasharray="1.6 1.8"
                vectorEffect="non-scaling-stroke"
                strokeWidth={1}
              />
            </g>
          );
        })}
      </svg>

      {/* anchor nodes — where each service lives on the mountain */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[9] hidden lg:block">
        {SERVICE_CHIPS.map(({ name, status, ax, ay }) => {
          const meta = CHIP_STATUS[status];
          return (
            <span
              key={name}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${ax * 100}%`, top: `${ay * 100}%` }}
            >
              <span
                className="fh-anchor block h-2 w-2 rounded-full"
                style={{ backgroundColor: meta.color, boxShadow: `0 0 10px ${meta.color}` }}
              />
              <span
                className="fh-anchor-ring absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                style={{ borderColor: meta.color }}
              />
            </span>
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-0 z-10">
        {SERVICE_CHIPS.map(({ name, status, icon: Icon, top, right, dur, delay, lgOnly, detail, note }) => {
          const meta = CHIP_STATUS[status];
          return (
            <div
              key={name}
              className={`fh-bob group pointer-events-auto absolute cursor-default items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.05] py-2 pl-2 pr-3 backdrop-blur-md transition-transform duration-200 hover:scale-[1.05] hover:border-white/25 ${
                lgOnly ? 'hidden lg:flex' : 'flex'
              }`}
              style={{ top, right, animationDuration: `${dur}s`, animationDelay: `${delay}s` }}
              onMouseEnter={() =>
                window.dispatchEvent(new CustomEvent('oncall:chip-hover', { detail: name }))
              }
              onMouseLeave={() =>
                window.dispatchEvent(new CustomEvent('oncall:chip-hover', { detail: null }))
              }
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span>
                <span className="block text-xs font-semibold text-white">{name}</span>
                <span
                  className="block text-[10px] uppercase tracking-[0.14em]"
                  style={{ fontFamily: MONO, color: meta.color }}
                >
                  {meta.label}
                </span>
              </span>
              <span
                className="ml-1 h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: meta.color, boxShadow: `0 0 8px ${meta.color}` }}
              />

              {/* hover detail card */}
              <div className="pointer-events-none invisible absolute right-0 top-[calc(100%+8px)] z-30 w-[230px] translate-y-1 rounded-xl border border-white/15 bg-black/90 p-3 opacity-0 shadow-2xl backdrop-blur-md transition-all duration-200 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                <p
                  className="text-[9px] uppercase tracking-[0.2em]"
                  style={{ fontFamily: MONO, color: meta.color }}
                >
                  {name} · {meta.label}
                </p>
                <dl className="mt-2 space-y-1">
                  {detail.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between">
                      <dt className="text-[10px] text-white/45" style={{ fontFamily: MONO }}>
                        {k}
                      </dt>
                      <dd className="text-[10px] tabular-nums text-white/85" style={{ fontFamily: MONO }}>
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 border-t border-white/10 pt-1.5 text-[10px] leading-snug text-white/55">
                  {note}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* readability scrim behind the copy */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[15]"
        style={{
          background:
            'linear-gradient(100deg, rgba(5,5,5,0.72) 0%, rgba(5,5,5,0.35) 42%, transparent 68%)',
        }}
      />

      <StaggerGroup
        className="pointer-events-none relative z-20 flex min-h-[calc(100vh-150px)] flex-col justify-center gap-6 p-7 sm:p-10 lg:max-w-[58%] lg:justify-start lg:p-12 lg:pt-[3vh]"
        delay={0.15}
      >
        <StaggerItem>
          <h1
            className="font-semibold leading-[1.02] tracking-[-0.03em] text-white"
            style={{ fontSize: 'clamp(44px, 4.2vw, 64px)', textShadow: '0 2px 24px rgba(0,0,0,0.6)' }}
          >
            {/* nowrap from sm up: each sentence holds one line, floating over the terrain */}
            <span className="block sm:whitespace-nowrap">
              Incidents happen<span className="text-[#F16524]">.</span>
            </span>
            <span className="block sm:whitespace-nowrap">
              We’re already on it<span className="text-[#F16524]">.</span>
            </span>
          </h1>
        </StaggerItem>

        <StaggerItem>
          <p className="max-w-md text-[15px] leading-relaxed text-white/60">
            OnCall AI correlates signals, detects issues, and brings the right context to resolve
            faster.
          </p>
        </StaggerItem>

        <StaggerItem>
          <div className="pointer-events-auto flex flex-wrap items-center gap-3">
            <Link
              to="/dashboard"
              className="rounded-xl bg-[#F16524] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#F16524]/30 transition-all hover:scale-[1.02] hover:bg-[#FF8233] active:scale-95"
            >
              Open Dashboard
            </Link>
            <Link
              to="/demo"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/90 backdrop-blur-md transition-colors hover:border-white/30 hover:bg-white/[0.08] hover:text-white"
            >
              Live Demo
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </StaggerItem>

        <StaggerItem>
          <Link
            to="/dashboard"
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 backdrop-blur-md transition-colors hover:border-white/25"
          >
            <span className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-[#52D273]" />
            <span
              className="text-[10px] uppercase tracking-[0.18em] text-white/60"
              style={{ fontFamily: MONO }}
            >
              All systems operational · View status →
            </span>
          </Link>
        </StaggerItem>
      </StaggerGroup>
    </section>
  );
}

/* ── stats row ────────────────────────────────────────────────────────────── */

const STATS: {
  label: string;
  target: number;
  format: (n: number) => string;
  delta: string;
  deltaTone: 'good' | 'muted';
  trendUp?: boolean;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
}[] = [
  {
    label: 'Incidents Today',
    target: 24,
    format: (n) => String(Math.round(n)),
    delta: '+12% vs yesterday',
    deltaTone: 'good',
    trendUp: true,
    icon: AlertTriangle,
    iconBg: 'rgba(241,101,36,0.15)',
    iconColor: '#FF8233',
  },
  {
    label: 'MTTR',
    target: 18,
    format: (n) => `${Math.round(n)}m`,
    delta: '8% faster',
    deltaTone: 'good',
    icon: Clock,
    iconBg: 'rgba(109,74,255,0.18)',
    iconColor: '#a58bff',
  },
  {
    label: 'Alerts Processed',
    target: 1429,
    format: (n) => Math.round(n).toLocaleString('en-US'),
    delta: '+23%',
    deltaTone: 'good',
    trendUp: true,
    icon: Bell,
    iconBg: 'rgba(34,211,238,0.14)',
    iconColor: '#5ce6ff',
  },
  {
    label: 'Services Monitored',
    target: 37,
    format: (n) => String(Math.round(n)),
    delta: 'All systems active',
    deltaTone: 'muted',
    icon: Server,
    iconBg: 'rgba(82,210,115,0.14)',
    iconColor: '#52D273',
  },
  {
    label: 'AI Detections',
    target: 96,
    format: (n) => `${Math.round(n)}%`,
    delta: 'Accuracy',
    deltaTone: 'muted',
    icon: Brain,
    iconBg: 'rgba(109,74,255,0.18)',
    iconColor: '#a58bff',
  },
];

/** Hold 0 briefly, then release the real target so AnimatedNumber counts up. */
function useCountUp(target: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setValue(target), 400);
    return () => window.clearTimeout(t);
  }, [target]);
  return value;
}

function StatTile({ stat }: { stat: (typeof STATS)[number] }) {
  const value = useCountUp(stat.target);
  const Icon = stat.icon;
  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: stat.iconBg, color: stat.iconColor }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span
          className="text-[10px] uppercase tracking-[0.16em] text-white/40"
          style={{ fontFamily: MONO }}
        >
          {stat.label}
        </span>
      </div>
      <AnimatedNumber
        value={value}
        format={stat.format}
        className="mt-3 block text-[28px] font-bold leading-none tracking-tight text-white"
      />
      <p
        className={`mt-2 flex items-center gap-1 text-[11px] ${
          stat.deltaTone === 'good' ? 'text-[#52D273]' : 'text-white/40'
        }`}
        style={{ fontFamily: MONO }}
      >
        {stat.trendUp && <TrendingUp className="h-3 w-3" />}
        {stat.delta}
      </p>
    </GlassCard>
  );
}

function StatsRow() {
  return (
    <StaggerGroup className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-5" delay={0.35}>
      {STATS.map((stat) => (
        <StaggerItem key={stat.label}>
          <StatTile stat={stat} />
        </StaggerItem>
      ))}
    </StaggerGroup>
  );
}

/* ── bottom row: recent incidents + AI insights ───────────────────────────── */

const SEVERITY_BADGE: Record<Severity, { label: string; className: string }> = {
  high: {
    label: 'Critical',
    className: 'border-[#FF3B30]/40 bg-[#FF3B30]/15 text-[#FF6B62]',
  },
  medium: {
    label: 'Warning',
    className: 'border-[#FF8233]/40 bg-[#F16524]/15 text-[#FF8233]',
  },
  low: {
    label: 'Low',
    className: 'border-white/15 bg-white/[0.06] text-white/60',
  },
};

function SeverityBadge({ severity }: { severity: Severity }) {
  const meta = SEVERITY_BADGE[severity];
  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${meta.className}`}
      style={{ fontFamily: MONO }}
    >
      {meta.label}
    </span>
  );
}

function IncidentRow({
  title,
  meta,
  time,
  severity,
}: {
  title: string;
  meta: string;
  time: string;
  severity: Severity;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{title}</span>
        <span className="mt-0.5 block text-[11px] text-white/40" style={{ fontFamily: MONO }}>
          {meta} · {time}
        </span>
      </span>
      <SeverityBadge severity={severity} />
    </li>
  );
}

function RecentIncidentsCard() {
  // null = loading; [] = error/empty → demo fallback row.
  const [incidents, setIncidents] = useState<IncidentSummary[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getIncidents({ limit: 3 }, ctrl.signal)
      .then((res) => setIncidents(res.incidents.slice(0, 3)))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setIncidents([]);
      });
    return () => ctrl.abort();
  }, []);

  return (
    <GlassCard className="flex h-full flex-col p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Recent Incidents</h2>
        <Link
          to="/incidents"
          className="inline-flex items-center gap-1 text-xs font-medium text-white/50 transition-colors hover:text-[#FF8233]"
        >
          View all
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <ul className="mt-4 flex flex-1 flex-col gap-2">
        {incidents === null ? (
          <>
            <li className="h-[54px] animate-shimmer rounded-xl bg-white/[0.04]" />
            <li className="h-[54px] animate-shimmer rounded-xl bg-white/[0.04]" />
            <li className="h-[54px] animate-shimmer rounded-xl bg-white/[0.04]" />
          </>
        ) : incidents.length === 0 ? (
          <IncidentRow
            title="API Gateway Timeout"
            meta="Production"
            time="10:24 AM"
            severity="high"
          />
        ) : (
          incidents.map((inc) => (
            <IncidentRow
              key={inc.id}
              title={inc.title}
              meta={`Production · ${inc.service}`}
              time={relativeTime(inc.opened_at)}
              severity={inc.severity}
            />
          ))
        )}
      </ul>
    </GlassCard>
  );
}

function AiInsightsCard() {
  return (
    <GlassCard className="flex h-full flex-col p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">AI Insights</h2>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-xs font-medium text-white/50 transition-colors hover:text-[#FF8233]"
        >
          View all
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="mt-4 flex flex-1 items-start gap-3.5 rounded-xl border border-[#F16524]/20 bg-[#F16524]/[0.06] p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F16524]/20 text-[#FF8233]">
          <Brain style={{ width: 18, height: 18 }} />
        </span>
        <div className="min-w-0">
          <p className="text-sm leading-relaxed text-white/90">
            Spike in auth failures correlated with deployment{' '}
            <span className="text-[#FF8233]" style={{ fontFamily: MONO }}>
              v2.14.3
            </span>
          </p>
          <p className="mt-2 text-[11px] text-white/40" style={{ fontFamily: MONO }}>
            2m ago
          </p>
        </div>
      </div>
    </GlassCard>
  );
}
