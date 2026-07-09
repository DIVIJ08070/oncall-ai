import { Activity, AlertTriangle, Plug, FlaskConical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Primary routes (DESIGN_SPEC §4 SideNav). Icons from the canonical set (§3). */
export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match nested routes (e.g. Incidents highlights on `/incidents/:id`). */
  match: (pathname: string) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Activity, match: (p) => p === '/' },
  {
    to: '/incidents',
    label: 'Incidents',
    icon: AlertTriangle,
    match: (p) => p.startsWith('/incidents'),
  },
  {
    to: '/onboarding',
    label: 'Connect',
    icon: Plug,
    match: (p) => p.startsWith('/onboarding'),
  },
  { to: '/demo', label: 'Demo', icon: FlaskConical, match: (p) => p.startsWith('/demo') },
];
