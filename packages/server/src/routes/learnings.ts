import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { RepoLearningRow } from '../db/rows.js';
import { sendError } from '../http/errors.js';
import { computeLevel } from '../services/learning/levels.js';

/**
 * Per-repo self-learning routes:
 *
 *   GET  /api/v1/learnings/:owner/:repo → { learnings, stats, level }
 *   POST /api/v1/learnings/rate         { repo, prNumber?, errorClass, rootCause,
 *                                         fixApproach?, rating: -1|1, note? }
 *                                       → { ok: true, learning }
 *
 * Ratings reinforce: the same repo + errorClass + rootCause bumps the existing
 * learning's confirmations instead of creating a duplicate. Same openness as
 * the code-review routes: no session auth.
 */

const RateRequestSchema = z.object({
  repo: z
    .string()
    .min(1)
    .max(300)
    .regex(/^[^/\s]+\/[^/\s]+$/, 'repo must be "owner/name"'),
  prNumber: z.number().int().positive().optional(),
  errorClass: z.string().min(1).max(200),
  rootCause: z.string().min(1).max(2000),
  fixApproach: z.string().max(2000).optional(),
  rating: z.union([z.literal(-1), z.literal(1)]),
  note: z.string().max(1000).optional(),
});

/** Serialize a DB row to the camelCase wire shape the dashboard consumes. */
function toLearningDto(row: RepoLearningRow): Record<string, unknown> {
  return {
    id: row.id,
    errorClass: row.error_class,
    rootCause: row.root_cause,
    ...(row.fix_approach !== null ? { fixApproach: row.fix_approach } : {}),
    source: row.source,
    rating: row.rating,
    ...(row.note !== null ? { note: row.note } : {}),
    confirmations: row.confirmations,
    ...(row.pr_number !== null ? { prNumber: row.pr_number } : {}),
    createdAt: row.created_at,
  };
}

export function registerLearningsRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  const { db } = ctx;

  // GET /api/v1/learnings/:owner/:repo — everything the dashboard renders.
  app.get('/api/v1/learnings/:owner/:repo', async (req, reply) => {
    const { owner, repo } = req.params as { owner: string; repo: string };
    const fullRepo = `${owner}/${repo}`;
    const learnings = db.dao.repoLearnings.listByRepo(fullRepo);
    const stats = db.dao.repoLearnings.stats(fullRepo);
    return reply.code(200).send({
      learnings: learnings.map(toLearningDto),
      stats,
      level: computeLevel(stats.total),
    });
  });

  // POST /api/v1/learnings/rate — explicit 👍/👎 on an AI-generated PR.
  app.post('/api/v1/learnings/rate', async (req, reply) => {
    const parsed = RateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid rate request', {
        issues: parsed.error.issues,
      });
    }
    const body = parsed.data;
    const learning = db.dao.repoLearnings.confirmOrCreate({
      repo: body.repo,
      error_class: body.errorClass,
      root_cause: body.rootCause,
      fix_approach: body.fixApproach ?? null,
      source: 'rating',
      rating: body.rating,
      note: body.note ?? null,
      pr_number: body.prNumber ?? null,
    });
    return reply.code(200).send({ ok: true, learning: toLearningDto(learning) });
  });
}
