import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Brain,
  Clock,
  CreditCard,
  Database,
  GitPullRequest,
  Globe,
  GraduationCap,
  Home,
  Layers,
  LayoutDashboard,
  Moon,
  PlayCircle,
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

/**
 * Futuristic product-shell home (`/`) — a dark landing that mimics the console:
 * floating glass sidebar, hero copy over the live TerrainNetwork canvas (glowing
 * network-terrain that reacts to the cursor), floating service-status chips,
 * a stat-tile row, and Recent Incidents + AI Insights cards.
 *
 * Brand-fixed dark surface (like SpotlightHero): raw brand hex on purpose, not
 * theme tokens. `SpotlightHero.tsx` stays on disk as the revert path.
 */

const MONO = "'JetBrains Mono', ui-monospace, monospace";

/* ── shared nav data ──────────────────────────────────────────────────────── */

const SIDE_NAV: { label: string; to: string; icon: LucideIcon; end?: boolean }[] = [
  { label: 'Home', to: '/', icon: Home, end: true },
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Incidents', to: '/incidents', icon: AlertTriangle },
  { label: 'Code Review', to: '/code-review', icon: GitPullRequest },
  { label: 'Self-Learning', to: '/learning', icon: GraduationCap },
  { label: 'Live Demo', to: '/demo', icon: PlayCircle },
];

const TOP_TABS: { label: string; to: string }[] = [
  { label: 'Home', to: '/' },
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Incidents', to: '/incidents' },
  { label: 'Integrations', to: '/onboarding' },
  { label: 'Live Demo', to: '/demo' },
];

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

      <div className="relative mx-auto flex max-w-[1400px] items-start gap-6 p-4 sm:p-6">
        <Sidebar />

        <main className="min-w-0 flex-1">
          <Entrance y={8}>
            <TopBar />
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

/* ── glass primitives ─────────────────────────────────────────────────────── */

function GlassCard({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md ${className}`}
    >
      {children}
    </div>
  );
}

function LogoDiamond({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="#F16524" aria-hidden="true">
      <path d="M256 256 L128 256 L0 128 L128 128 Z M256 128 L128 128 L0 0 L128 0 Z" />
    </svg>
  );
}

/* ── sidebar ──────────────────────────────────────────────────────────────── */

function Sidebar() {
  return (
    <Entrance className="sticky top-6 hidden w-[260px] shrink-0 self-start lg:block" y={12}>
      <GlassCard className="flex max-h-[calc(100vh-48px)] flex-col gap-5 p-4">
        <Link to="/" className="flex items-center gap-2.5 px-2 pt-1">
          <LogoDiamond />
          <span className="text-[17px] font-bold tracking-tight text-white">OnCall AI</span>
        </Link>

        <nav className="flex flex-col gap-1">
          {SIDE_NAV.map(({ label, to, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border border-[#F16524]/30 bg-[#F16524]/15 text-[#FF8233]'
                    : 'border border-transparent text-white/60 hover:bg-white/[0.06] hover:text-white'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="rounded-xl border border-[#F16524]/25 bg-[#F16524]/[0.07] p-4">
          <p
            className="text-[10px] uppercase tracking-[0.24em] text-[#FF8233]"
            style={{ fontFamily: MONO }}
          >
            Get Started
          </p>
          <p className="mt-2 text-xs leading-relaxed text-white/60">
            Connect your services and start monitoring.
          </p>
          <Link
            to="/onboarding"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#F16524]/50 px-3 py-2 text-xs font-semibold text-[#FF8233] transition-colors hover:bg-[#F16524]/15 hover:text-white"
          >
            Setup Wizard
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="mt-auto flex items-center gap-3 border-t border-white/10 px-2 pt-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F16524] to-[#6d4aff] text-xs font-bold text-white">
            OA
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">OnCall AI</span>
            <span className="block truncate text-[11px] text-white/40">Demo workspace</span>
          </span>
        </div>
      </GlassCard>
    </Entrance>
  );
}

/* ── top bar ──────────────────────────────────────────────────────────────── */

function TopBar() {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
      {/* compact brand when the sidebar is hidden */}
      <Link to="/" className="flex items-center gap-2 lg:hidden">
        <LogoDiamond size={18} />
        <span className="text-sm font-bold text-white">OnCall AI</span>
      </Link>

      <nav className="hidden items-center gap-1 md:flex">
        {TOP_TABS.map(({ label, to }) => (
          <Link
            key={label}
            to={to}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              to === '/'
                ? 'text-white'
                : 'text-white/50 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 sm:inline-flex">
          <span className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-[#52D273]" />
          <span
            className="text-[10px] uppercase tracking-[0.18em] text-white/60"
            style={{ fontFamily: MONO }}
          >
            System Status · All Systems Operational
          </span>
        </span>
        <span
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/50"
        >
          <Moon className="h-3.5 w-3.5" />
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#F16524] to-[#6d4aff] text-[10px] font-bold text-white">
          OA
        </span>
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
}[] = [
  { name: 'Auth Service', status: 'healthy', icon: Shield, top: '13%', right: '26%', dur: 7, delay: 0 },
  { name: 'Payment Gateway', status: 'warning', icon: CreditCard, top: '38%', right: '7%', dur: 8.2, delay: 1.4 },
  { name: 'User Service', status: 'healthy', icon: Users, top: '24%', right: '5%', dur: 6.4, delay: 2.2, lgOnly: true },
  { name: 'Database', status: 'healthy', icon: Database, top: '70%', right: '33%', dur: 9, delay: 0.8, lgOnly: true },
  { name: 'Cache Layer', status: 'critical', icon: Layers, top: '62%', right: '18%', dur: 6, delay: 1.8 },
  { name: 'API Gateway', status: 'warning', icon: Globe, top: '82%', right: '8%', dur: 8.6, delay: 2.8, lgOnly: true },
];

function Hero() {
  return (
    <section className="relative min-h-[520px] overflow-hidden rounded-3xl border border-white/10 bg-[#070608]">
      <TerrainNetwork className="absolute inset-0" />

      {/* floating service chips — decorative, cursor passes through to the terrain */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
        {SERVICE_CHIPS.map(({ name, status, icon: Icon, top, right, dur, delay, lgOnly }) => {
          const meta = CHIP_STATUS[status];
          return (
            <div
              key={name}
              className={`fh-bob absolute items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.05] py-2 pl-2 pr-3 backdrop-blur-md ${
                lgOnly ? 'hidden lg:flex' : 'flex'
              }`}
              style={{ top, right, animationDuration: `${dur}s`, animationDelay: `${delay}s` }}
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
        className="pointer-events-none relative z-20 flex min-h-[520px] flex-col justify-center gap-6 p-7 sm:p-10 lg:max-w-[58%] lg:p-12"
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
