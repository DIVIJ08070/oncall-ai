import { randomUUID } from 'node:crypto';
import type { HealthReport } from './report.js';

/**
 * Project Health — in-memory async job store. Reports take 1-3 minutes, so
 * POST returns a job id immediately and the dashboard polls GET /:id. A Map
 * (insertion-ordered) keeps only the most recent jobs; timestamps are epoch ms
 * per the SPEC convention.
 */

export type HealthJobStatus = 'running' | 'done' | 'error';

export interface HealthJob {
  id: string;
  status: HealthJobStatus;
  repoUrl: string;
  startedAt: number;
  error?: string;
  report?: HealthReport;
}

const MAX_JOBS = 20;

const jobs = new Map<string, HealthJob>();

export function createJob(repoUrl: string): HealthJob {
  const job: HealthJob = {
    id: randomUUID(),
    status: 'running',
    repoUrl,
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  // Evict the oldest jobs beyond the cap (Map preserves insertion order).
  while (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next().value;
    if (oldest === undefined) break;
    jobs.delete(oldest);
  }
  return job;
}

export function getJob(id: string): HealthJob | undefined {
  return jobs.get(id);
}

export function completeJob(id: string, report: HealthReport): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'done';
  job.report = report;
  delete job.error;
}

export function failJob(id: string, message: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'error';
  job.error = message;
}

/** Latest completed job for a repo (normalized URL match), if any. */
export function latestDoneJobFor(repoUrl: string): HealthJob | undefined {
  const norm = (u: string): string =>
    u.toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
  let best: HealthJob | undefined;
  for (const job of jobs.values()) {
    if (job.status !== 'done' || norm(job.repoUrl) !== norm(repoUrl)) continue;
    if (!best || job.startedAt > best.startedAt) best = job;
  }
  return best;
}
