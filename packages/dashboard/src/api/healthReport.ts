import { apiFetch } from './client';

/**
 * Project Health clients — `POST /api/v1/health-report` kicks off an async
 * repo analysis job (shallow clone → static scan → AI report, 1-3 min) and
 * `GET /api/v1/health-report/:id` polls it. Kept in its own module per the
 * api-layer convention (see incidents.ts). DTOs mirror the server contract
 * exactly; they live here (not `@oncall/shared`) as the feature's own surface.
 */

export type HealthReportStatus = 'running' | 'done' | 'error';

export type IssueSeverity = 'critical' | 'warning' | 'info';

export interface HealthIssue {
  severity: IssueSeverity;
  title: string;
  detail: string;
  file?: string;
}

export interface HealthReport {
  /** 0-100. */
  score: number;
  /** "A".."F". */
  grade: string;
  summary: string;
  stats: {
    files: number;
    linesOfCode: number;
    languages: { name: string; pct: number }[];
  };
  frameworks: string[];
  apis: { method: string; path: string; file: string }[];
  databases: { type: string; evidence: string }[];
  quality: {
    strengths: string[];
    issues: HealthIssue[];
    suggestions: string[];
  };
  security: { findings: string[]; secretsFound: boolean };
  tests: { present: boolean; note: string };
  docs: { present: boolean; note: string };
  engine: 'claude' | 'gemini';
}

export interface StartHealthReportResponse {
  id: string;
  status: 'running';
}

export interface HealthReportJob {
  id: string;
  status: HealthReportStatus;
  repoUrl: string;
  startedAt: string;
  error?: string;
  report?: HealthReport;
}

/** `POST /api/v1/health-report` — start an analysis job for a public GitHub repo (202). */
export function startHealthReport(
  repoUrl: string,
  signal?: AbortSignal,
): Promise<StartHealthReportResponse> {
  return apiFetch<StartHealthReportResponse>('/health-report', {
    method: 'POST',
    body: { repoUrl },
    signal,
  });
}

/** `GET /api/v1/health-report/:id` — poll the job until `status` leaves `"running"`. */
export function getHealthReport(
  id: string,
  signal?: AbortSignal,
): Promise<HealthReportJob> {
  return apiFetch<HealthReportJob>(`/health-report/${encodeURIComponent(id)}`, {
    signal,
  });
}

/** Newest finished report for a repo, or a 404 error if none exists yet. */
export function getLatestHealthReport(repoUrl: string): Promise<HealthReportJob> {
  return apiFetch<HealthReportJob>(
    `/health-report/latest?repoUrl=${encodeURIComponent(repoUrl)}`,
  );
}
