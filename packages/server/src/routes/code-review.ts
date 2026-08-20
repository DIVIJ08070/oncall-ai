import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { sendError } from '../http/errors.js';
import {
  assertReviewEngineAvailable,
  reviewDiff,
  reviewFile,
} from '../services/code-review/gemini.js';
import { collectRepoFiles, parseRepoUrl } from '../services/code-review/github.js';
import {
  addWatch,
  listState,
  removeWatch,
} from '../services/code-review/watcher.js';
import {
  CodeReviewError,
  type FileReviewResult,
  type RepoReviewResult,
} from '../services/code-review/types.js';

/**
 * Code Review Buddy (mini-app) — Gemini-backed review endpoints:
 *
 *   POST   /api/v1/code-review           { diff, prTitle?, customRules? } → ReviewResult
 *   POST   /api/v1/code-review/repo      { repoUrl, customRules? }        → RepoReviewResult
 *   GET    /api/v1/code-review/watch     → { watches, reviews (newest-first, ≤50) }
 *   POST   /api/v1/code-review/watch     { repoUrl, customRules? } → 201 { watch }
 *   DELETE /api/v1/code-review/watch/:id → 204
 *
 * Same openness as the demo routes: no session auth. All service failures are
 * typed `CodeReviewError`s mapped 1:1 onto the SPEC §7 error envelope (503 when
 * GEMINI_API_KEY is missing, 502 on upstream trouble, 404 unknown repo, …).
 */

const CustomRuleSchema = z.object({
  id: z.string().max(64),
  category: z.enum([
    'architecture',
    'folder-structure',
    'reusability',
    'code-hygiene',
    'naming',
    'custom',
  ]),
  description: z.string().max(500),
  severity: z.enum(['warning', 'error']),
  enabled: z.boolean(),
});

const DiffReviewRequestSchema = z.object({
  diff: z.string().min(1).max(100000),
  prTitle: z.string().max(300).optional(),
  customRules: z.array(CustomRuleSchema).max(50).optional(),
});

const RepoReviewRequestSchema = z.object({
  repoUrl: z.string().min(1).max(500),
  customRules: z.array(CustomRuleSchema).max(50).optional(),
});

const WatchRequestSchema = z.object({
  repoUrl: z.string().min(1).max(500),
  customRules: z.array(CustomRuleSchema).max(50).optional(),
});

/** Max auto-reviews served by GET /watch (the store itself keeps 100). */
const WATCH_REVIEWS_LIMIT = 50;

/** Per-file review concurrency for repo scans. */
const REVIEW_CONCURRENCY = 3;

function sendCodeReviewError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof CodeReviewError) {
    return sendError(reply, err.status, err.code, err.message);
  }
  throw err; // global handler → 500 internal
}

export function registerCodeReviewRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  const { config } = ctx;

  // POST /api/v1/code-review — review a pasted unified diff.
  app.post('/api/v1/code-review', async (req, reply) => {
    const parsed = DiffReviewRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid review request', {
        issues: parsed.error.issues,
      });
    }
    try {
      const result = await reviewDiff(config, parsed.data);
      return await reply.code(200).send(result);
    } catch (err) {
      return sendCodeReviewError(reply, err);
    }
  });

  // POST /api/v1/code-review/repo — scan up to 15 files of a public repo.
  app.post('/api/v1/code-review/repo', async (req, reply) => {
    const parsed = RepoReviewRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid repo review request', {
        issues: parsed.error.issues,
      });
    }
    const { repoUrl, customRules } = parsed.data;

    const ref = parseRepoUrl(repoUrl);
    if (!ref) {
      return sendError(
        reply,
        400,
        'validation_error',
        'repoUrl must be a GitHub repository URL like https://github.com/owner/repo',
      );
    }

    try {
      // Fail fast on a missing key (exact 503) before any GitHub traffic.
      assertReviewEngineAvailable(config);

      const files = await collectRepoFiles(config, ref);

      // Review with a small concurrency pool; a failed file is logged + skipped.
      const slots: (FileReviewResult | null)[] = new Array<FileReviewResult | null>(
        files.length,
      ).fill(null);
      let usedEngine: 'claude' | 'gemini' | undefined;
      let cursor = 0;
      async function worker(): Promise<void> {
        while (cursor < files.length) {
          const index = cursor++;
          const file = files[index];
          try {
            const { score, categories, engine } = await reviewFile(config, {
              filePath: file.path,
              content: file.content,
              ...(customRules ? { customRules } : {}),
            });
            usedEngine = usedEngine ?? engine;
            slots[index] = { filePath: file.path, score, categories };
          } catch (err) {
            console.log(
              `[code-review] review failed for ${file.path} — ` +
                `${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(REVIEW_CONCURRENCY, files.length) }, () =>
          worker(),
        ),
      );

      const fileReviews = slots.filter((r): r is FileReviewResult => r !== null);
      if (fileReviews.length === 0) {
        return sendError(
          reply,
          502,
          'upstream_error',
          'Every file review failed upstream — try again in a moment.',
        );
      }

      const overallScore = Math.round(
        fileReviews.reduce((sum, r) => sum + r.score, 0) / fileReviews.length,
      );
      const result: RepoReviewResult = {
        ...(usedEngine ? { engine: usedEngine } : {}),
        overallScore,
        repoUrl,
        filesReviewed: fileReviews.length,
        fileReviews,
      };
      return await reply.code(200).send(result);
    } catch (err) {
      return sendCodeReviewError(reply, err);
    }
  });

  // GET /api/v1/code-review/watch — watched repos + recent auto-reviews.
  app.get('/api/v1/code-review/watch', async (_req, reply) => {
    const state = listState(config);
    return reply.code(200).send({
      watches: state.watches,
      reviews: state.reviews.slice(0, WATCH_REVIEWS_LIMIT),
    });
  });

  // POST /api/v1/code-review/watch — register a repo for PR-Watch auto-review.
  app.post('/api/v1/code-review/watch', async (req, reply) => {
    const parsed = WatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid watch request', {
        issues: parsed.error.issues,
      });
    }
    try {
      // addWatch throws CodeReviewError: 400 bad URL, 409 already watched,
      // 404 unknown repo, 429/502 GitHub trouble.
      const watch = await addWatch(
        config,
        parsed.data.repoUrl,
        parsed.data.customRules,
      );
      return await reply.code(201).send({ watch });
    } catch (err) {
      return sendCodeReviewError(reply, err);
    }
  });

  // DELETE /api/v1/code-review/watch/:id — unregister a watched repo.
  app.delete('/api/v1/code-review/watch/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!removeWatch(config, id)) {
      return sendError(reply, 404, 'not_found', 'Watch not found');
    }
    return reply.code(204).send();
  });
}
