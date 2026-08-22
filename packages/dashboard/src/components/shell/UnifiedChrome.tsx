import { Link, NavLink } from 'react-router-dom';
import {
  Home,
  LayoutDashboard,
  AlertTriangle,
  GitPullRequest,
  GraduationCap,
  HeartPulse,
  PlayCircle,
  ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Entrance } from '../motion/primitives';
import { MomoAssistantToggle } from '../assistant/MomoToggle';

/**
 * UnifiedChrome — ONE sidebar + top bar shared by the marketing home and the
 * console, so navigating between Home / Dashboard / Incidents never swaps the
 * shell. Visual language comes from the approved home mockup: glass cards,
 * orange active pill, Get Started card, workspace chip, centered tab nav with
 * the system-status pill.
 */

export const MONO = "'JetBrains Mono', ui-monospace, monospace";

const SIDE_NAV: { label: string; to: string; icon: LucideIcon; end?: boolean }[] = [
  { label: 'Home', to: '/', icon: Home, end: true },
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Incidents', to: '/incidents', icon: AlertTriangle },
  { label: 'Code Review', to: '/code-review', icon: GitPullRequest },
  { label: 'Project Health', to: '/health', icon: HeartPulse },
  { label: 'Self-Learning', to: '/learning', icon: GraduationCap },
  { label: 'Live Demo', to: '/demo', icon: PlayCircle },
];

const TOP_TABS: { label: string; to: string; end?: boolean }[] = [
  { label: 'Home', to: '/', end: true },
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Incidents', to: '/incidents' },
  { label: 'Self-Learning', to: '/learning' },
  { label: 'Integrations', to: '/onboarding' },
  { label: 'Live Demo', to: '/demo' },
];

export function GlassCard({
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

export function LogoDiamond({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="#F16524" aria-hidden="true">
      <path d="M256 256 L128 256 L0 128 L128 128 Z M256 128 L128 128 L0 0 L128 0 Z" />
    </svg>
  );
}

export function UnifiedSidebar() {
  return (
    <Entrance className="sticky top-6 hidden w-[260px] shrink-0 self-start lg:block" y={12}>
      <GlassCard className="flex h-[calc(100vh-48px)] flex-col gap-5 p-4">
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

        <MomoAssistantToggle />
      </GlassCard>
    </Entrance>
  );
}

export function UnifiedTopBar() {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
      {/* compact brand when the sidebar is hidden */}
      <Link to="/" className="flex items-center gap-2 lg:hidden">
        <LogoDiamond size={18} />
        <span className="text-sm font-bold text-white">OnCall AI</span>
      </Link>

      <nav className="hidden items-center gap-1 md:flex">
        {TOP_TABS.map(({ label, to, end }) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                isActive ? 'text-white' : 'text-white/50 hover:bg-white/[0.06] hover:text-white'
              }`
            }
          >
            {label}
          </NavLink>
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
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#F16524] to-[#6d4aff] text-[10px] font-bold text-white">
          OA
        </span>
      </div>
    </div>
  );
}
