import type {
  HealthStatus,
  LogLevel,
  Severity,
  IncidentStatus,
} from '@oncall/shared';

/**
 * Status → token mapping (DESIGN_SPEC §2.2). Status hues are reserved and ALWAYS
 * ship with a text label (never color-alone — §11). Each entry names the CSS
 * token (a `--token` name) so callers resolve it via `v()` / `tint()`.
 */

export interface StatusStyle {
  /** CSS custom-property name (without `--`). */
  token: string;
  label: string;
}

export function healthStyle(health: HealthStatus): StatusStyle {
  switch (health) {
    case 'healthy':
      return { token: 'ok', label: 'Healthy' };
    case 'degraded':
      return { token: 'warn', label: 'Degraded' };
    case 'down':
      return { token: 'critical', label: 'Down' };
    case 'silent':
      return { token: 'silent', label: 'Silent' };
  }
}

export function levelStyle(level: LogLevel): StatusStyle {
  switch (level) {
    case 'error':
      return { token: 'critical', label: 'error' };
    case 'warn':
      return { token: 'warn', label: 'warn' };
    case 'info':
      return { token: 'ink-2', label: 'info' };
    case 'debug':
      return { token: 'ink-muted-text', label: 'debug' };
  }
}

export function severityStyle(sev: Severity): StatusStyle {
  switch (sev) {
    case 'high':
      return { token: 'critical', label: 'High' };
    case 'medium':
      return { token: 'warn', label: 'Medium' };
    case 'low':
      return { token: 'ok', label: 'Low' };
  }
}

/** Incident status → a compact label + a status token for the list pill. */
export function incidentStatusStyle(status: IncidentStatus): StatusStyle {
  switch (status) {
    case 'open':
      return { token: 'critical', label: 'Open' };
    case 'investigating':
      return { token: 'accent', label: 'Investigating' };
    case 'fix_proposed':
      return { token: 'accent', label: 'Fix proposed' };
    case 'awaiting_merge':
      return { token: 'warn', label: 'Awaiting merge' };
    case 'verifying':
      return { token: 'warn', label: 'Verifying' };
    case 'escalated':
      return { token: 'serious', label: 'Escalated' };
    case 'resolved':
      return { token: 'ok', label: 'Resolved' };
    case 'closed':
      return { token: 'ink-muted-text', label: 'Closed' };
  }
}
