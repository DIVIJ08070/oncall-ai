import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { sendError } from '../http/errors.js';
import {
  completeJob,
  createJob,
  failJob,
  getJob,
  latestDoneJobFor,
} from '../services/health-report/jobs.js';
import { runHealthReport } from '../services/health-report/report.js';

/**
 * Project Health (mini-app) — async repo health-report endpoints:
 *
 *   POST /api/v1/health-report      { repoUrl } → 202 { id, status: "running" }
 *   GET  /api/v1/health-report/:id  → { id, status, repoUrl, startedAt, error?, report? }
 *
 * A report shallow-clones + scans the repo and runs an AI assessment (Claude
 * first via the developer's subscription, Gemini fallback), taking 1-3 min —
 * hence the job pattern. Same openness as the demo/code-review routes: no
 * session auth. Failures land on the job as `error`, never as a 5xx on POST.
 */

const StartRequestSchema = z.object({
  repoUrl: z
    .string()
    .min(1)
    .max(500)
    .regex(
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(?:\.git)?\/?$/,
      'repoUrl must be a public GitHub repository URL like https://github.com/owner/repo',
    ),
});

export function registerHealthReportRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  const { config } = ctx;

  // GET /api/v1/health-report/latest?repoUrl=… — newest finished report for a
  // repo, so the page can show the connected repo's health without re-running.
  app.get('/api/v1/health-report/latest', async (req, reply) => {
    const repoUrl = (req.query as Record<string, string | undefined>).repoUrl;
    if (!repoUrl) {
      return sendError(reply, 400, 'validation_error', 'repoUrl query param required');
    }
    const job = latestDoneJobFor(repoUrl);
    if (!job) {
      return sendError(reply, 404, 'not_found', 'No completed report for this repo yet');
    }
    return reply.send(job);
  });

  // POST /api/v1/health-report — start an async health-report job.
  app.post('/api/v1/health-report', async (req, reply) => {
    const parsed = StartRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid health-report request', {
        issues: parsed.error.issues,
      });
    }
    const { repoUrl } = parsed.data;

    const job = createJob(repoUrl);
    // Fire-and-forget: the runner settles the job; the client polls GET /:id.
    void runHealthReport(config, repoUrl)
      .then((report) => completeJob(job.id, report))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn('[health-report] job %s failed: %s', job.id, msg);
        failJob(job.id, msg);
      });

    return reply.code(202).send({ id: job.id, status: 'running' });
  });

  // GET /api/v1/health-report/:id — poll a job.
  app.get('/api/v1/health-report/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);
    if (!job) {
      return sendError(reply, 404, 'not_found', 'Health-report job not found');
    }
    return reply.code(200).send({
      id: job.id,
      status: job.status,
      repoUrl: job.repoUrl,
      startedAt: job.startedAt,
      ...(job.error !== undefined ? { error: job.error } : {}),
      ...(job.report !== undefined ? { report: job.report } : {}),
    });
  });
}
