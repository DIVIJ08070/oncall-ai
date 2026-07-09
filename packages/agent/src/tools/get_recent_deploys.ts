import {
  GetRecentDeploysInputSchema,
  type GetRecentDeploysInput,
  type GetRecentDeploysOutput,
} from '@oncall/shared';
import type { ToolContext } from '../ports.js';
import { RECENT_DEPLOYS_MAX, enforceResultCap } from '../bounded.js';

/**
 * Tool 3 — `get_recent_deploys` (SPEC §9). Real git log via the pinned client's
 * `listCommits` on the default branch, enriched with `deploys.is_current` from
 * the platform DB so the agent can spot the suspect deploy.
 */
export async function getRecentDeploys(
  ctx: ToolContext,
  input: GetRecentDeploysInput,
): Promise<GetRecentDeploysOutput> {
  const limit = Math.min(input.limit, RECENT_DEPLOYS_MAX);
  const commits = await ctx.octokit.listCommits({ limit });

  const currentSha = ctx.db.dao.deploys.getCurrent(ctx.customer.id)?.sha ?? null;

  const deploys = commits.slice(0, limit).map((c) => ({
    sha: c.sha,
    short_sha: c.short_sha,
    message_first_line: c.message_first_line,
    author: c.author,
    committed_at: c.committed_at,
    is_current: currentSha !== null && c.sha === currentSha,
  }));

  return enforceResultCap({ deploys }, 'deploys');
}

export const getRecentDeploysMeta = {
  name: 'get_recent_deploys' as const,
  description:
    'List recent commits on the pinned repo\'s default branch (real git history), flagged with which one is the currently deployed revision. Read-only.',
  inputSchema: GetRecentDeploysInputSchema,
};
