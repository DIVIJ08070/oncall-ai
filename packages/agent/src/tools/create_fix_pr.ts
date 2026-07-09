import {
  CreateFixPrInputSchema,
  type CreateFixPrInput,
  type CreateFixPrOutput,
  type CreateFixPrSuccess,
} from '@oncall/shared';
import type { PinnedPrResult, ToolContext } from '../ports.js';
import { generateFixBranch, isConfidentEnough } from '../guards.js';

/**
 * Tool 6 — `create_fix_pr` (SPEC §9) — the ONLY write tool.
 *
 * Order of enforcement:
 *  1. **FR-13 confidence gate** (code-enforced): below the threshold the tool
 *     REFUSES and returns `{ escalate:true, ... }` — the agent cannot open a PR
 *     when unsure; it must escalate.
 *  2. Auto-generate a fresh, guaranteed-writable branch (`assertWritableBranch`
 *     runs inside the pinned client before any ref write).
 *  3. Delegate to the pinned client's **create-only** write path
 *     (`openRevertPr`/`openPatchPr`) — repo pinning + branch guard + no-merge are
 *     structurally guaranteed there.
 *  4. Persist the `pull_requests` row + link the incident (`fix_proposed`) so the
 *     merge poller / recovery verifier (C9) and the dashboard can find the PR.
 */
export async function createFixPr(
  ctx: ToolContext,
  input: CreateFixPrInput,
): Promise<CreateFixPrOutput> {
  // (1) Confidence gate — refuse + escalate below threshold (FR-13).
  if (!isConfidentEnough(input.confidence, ctx.config.agent.confidenceThreshold)) {
    return { escalate: true, reason: 'confidence below threshold' };
  }

  // (2) Fresh writable branch (never the default/protected base).
  const branch = generateFixBranch(ctx.incident.id);

  // (3) Create-only GitHub write (revert preferred per BRD §12).
  let pr: PinnedPrResult;
  if (input.kind === 'revert') {
    // Schema guarantees revert_sha is present when kind==='revert'.
    pr = await ctx.octokit.openRevertPr({
      revertSha: input.revert_sha as string,
      branch,
      title: input.title,
      body: input.body,
    });
  } else {
    pr = await ctx.octokit.openPatchPr({
      files: (input.files ?? []).map((f) => ({ path: f.path, content: f.content })),
      branch,
      title: input.title,
      body: input.body,
    });
  }

  // (4) Persist + link so recovery/merge flows can track it (§10.4/§10.5).
  const prRow = ctx.db.dao.pullRequests.create({
    incident_id: ctx.incident.id,
    customer_id: ctx.customer.id,
    github_pr_number: pr.number,
    github_pr_id: pr.id,
    branch: pr.branch,
    base_branch: pr.base,
    title: input.title,
    url: pr.url,
    kind: input.kind,
    diagnostic_report: input.body,
    head_sha: pr.head_sha,
  });
  ctx.db.dao.incidents.update(ctx.incident.id, {
    status: 'fix_proposed',
    root_cause: input.root_cause,
    confidence: input.confidence,
    pr_id: prRow.id,
  });

  // Transparency seam: surface `pr_created` on the live feed (§7.3, NFR-06).
  await ctx.sink.prCreated?.({ number: pr.number, url: pr.url, kind: input.kind });

  const success: CreateFixPrSuccess = {
    pr_number: pr.number,
    url: pr.url,
    branch: pr.branch,
    head_sha: pr.head_sha,
    base: pr.base,
  };
  return success;
}

export const createFixPrMeta = {
  name: 'create_fix_pr' as const,
  description:
    'Open a real pull request that fixes the incident on the pinned repo — kind "revert" (revert_sha of the bad deploy, preferred) or "patch" (files[]). Refuses and escalates if confidence is below the configured threshold. The ONLY write tool; it can only ever create a new branch + PR, never merge or write the base branch.',
  inputSchema: CreateFixPrInputSchema,
};
