import type { LucideIcon } from 'lucide-react';
import { CheckCircle, AlertTriangle, Database, FlaskConical } from 'lucide-react';
import type { FailureMode } from '@oncall/shared';

/**
 * FailureModeSwitch metadata (DESIGN_SPEC §8.8). Each of the four modes carries its
 * icon, label, sub-copy, semantic accent token, and the victim endpoint the
 * TrafficGenerator should drive so the mode's signal (error-rate or p95 breach)
 * appears within the 15s detector window (SPEC §10.3, §12).
 */
export interface FailureModeMeta {
  mode: FailureMode;
  icon: LucideIcon;
  label: string;
  sub: string;
  /** CSS status token (without `--`) — §8.8 accents. */
  token: string;
  /** Traffic target key understood by `POST /demo/traffic` (`mix` for healthy). */
  target: string;
  /** True for the three failure modes (styled to signal "this breaks the app"). */
  failing: boolean;
}

export const FAILURE_MODE_META: FailureModeMeta[] = [
  {
    mode: 'healthy',
    icon: CheckCircle,
    label: 'Healthy',
    sub: 'Guards on, fast paths',
    token: 'ok',
    target: 'mix',
    failing: false,
  },
  {
    mode: 'bad_deploy',
    icon: AlertTriangle,
    label: 'Bad deploy (null-ref)',
    sub: '500s on /api/checkout',
    token: 'critical',
    target: 'checkout',
    failing: true,
  },
  {
    mode: 'slow_db',
    icon: Database,
    label: 'Slow DB',
    sub: 'p95 breach on /api/reports',
    token: 'warn',
    target: 'reports',
    failing: true,
  },
  {
    mode: 'config_error',
    icon: FlaskConical,
    label: 'Config error',
    sub: 'Throws on /api/pricing',
    token: 'warn',
    target: 'pricing',
    failing: true,
  },
];

export function metaFor(mode: FailureMode): FailureModeMeta {
  return FAILURE_MODE_META.find((m) => m.mode === mode) ?? FAILURE_MODE_META[0];
}
