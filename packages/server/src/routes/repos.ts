import type { FastifyInstance } from 'fastify';
import { RepoSelectRequestSchema } from '@oncall/shared';
import type { AppContext } from '../app.js';
import type { GithubGateway } from '../github/gateway.js';
import { repoIsWritable } from '../github/gateway.js';
import { currentCustomer, currentGithubToken } from '../github/session.js';
import { sendError } from '../http/errors.js';

/**
 * Repo management routes (SPEC §7.5, FR-15).
 *
 * - `GET  /api/v1/repos`        → repos the caller's token can access (onboarding picker)
 * - `POST /api/v1/repos/select` → bind `customers.github_owner/repo/default_branch`;
 *                                 `422` when the repo lacks Contents/PRs write.
 *
 * Auth: the session token, or (under `DEV_NO_AUTH`) the platform PAT so the demo
 * onboarding works before OAuth creds exist (SPEC §6/§14, MAPPING creds).
 */

export function registerRepoRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  github: GithubGateway,
): void {
  const { db, config } = ctx;

  app.get('/api/v1/repos', async (req, reply) => {
    const token = currentGithubToken(req, db, config);
    if (!token) {
      return sendError(reply, 401, 'unauthorized', 'Sign in with GitHub to list repos');
    }
    try {
      const repos = await github.listRepos(token);
      return reply.code(200).send({
        repos: repos.map((r) => ({
          owner: r.owner,
          repo: r.repo,
          default_branch: r.default_branch,
          private: r.private,
        })),
      });
    } catch (err) {
      // A fine-grained PAT can't always list-for-authenticated-user; fall back to
      // the pinned victim repo so the demo picker still shows a selectable repo.
      try {
        const only = await github.getRepo(token, config.github.owner, config.github.repo);
        return reply.code(200).send({
          repos: [
            {
              owner: only.owner,
              repo: only.repo,
              default_branch: only.default_branch,
              private: only.private,
            },
          ],
        });
      } catch {
        return sendError(
          reply,
          502,
          'upstream_error',
          err instanceof Error ? err.message : 'Failed to list GitHub repos',
        );
      }
    }
  });

  app.post('/api/v1/repos/select', async (req, reply) => {
    const parsed = RepoSelectRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid repo selection', {
        issues: parsed.error.issues,
      });
    }
    const { owner, repo } = parsed.data;

    const token = currentGithubToken(req, db, config);
    if (!token) {
      return sendError(reply, 401, 'unauthorized', 'Sign in with GitHub to select a repo');
    }
    const customer = currentCustomer(req, db, config);
    if (!customer) {
      return sendError(reply, 401, 'unauthorized', 'No customer bound to this session');
    }

    let info;
    try {
      info = await github.getRepo(token, owner, repo);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        return sendError(reply, 404, 'not_found', `Repo ${owner}/${repo} not found`);
      }
      return sendError(
        reply,
        502,
        'upstream_error',
        err instanceof Error ? err.message : 'Failed to read repo permissions',
      );
    }

    if (!repoIsWritable(info)) {
      // SPEC §7.5: 422 when Contents/PRs write permission is absent.
      return sendError(
        reply,
        422,
        'validation_error',
        `OnCall AI needs Contents + Pull requests write access on ${owner}/${repo} to open fix PRs`,
        { owner, repo, permissions: info.permissions ?? null },
      );
    }

    const updated = db.dao.customers.setRepo(
      customer.id,
      info.owner,
      info.repo,
      info.default_branch,
    );
    if (!updated) {
      return sendError(reply, 404, 'not_found', 'Customer not found');
    }
    return reply.code(200).send({
      customer: {
        id: updated.id,
        name: updated.name,
        github_owner: updated.github_owner,
        github_repo: updated.github_repo,
        default_branch: updated.default_branch,
      },
    });
  });
}
