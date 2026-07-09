import {
  GetDeployDiffInputSchema,
  type GetDeployDiffInput,
  type GetDeployDiffOutput,
  type DiffFile,
} from '@oncall/shared';
import type { PinnedDiffFile, ToolContext } from '../ports.js';
import {
  DIFF_MAX_BYTES,
  DIFF_MAX_FILES,
  byteLength,
  enforceResultCap,
  excerptPatch,
} from '../bounded.js';

/**
 * Tool 4 — `get_deploy_diff` (SPEC §9). Real diff via the pinned client
 * (`getCommit` for a single sha, `compareCommits` for a base/head pair). Caps:
 * ≤ 20 files, each patch ≤ 100 lines / 4000 chars, total payload ≤ 20 KB;
 * lockfiles and binaries are listed with an empty patch + `status:"skipped"`.
 */

/** Paths whose diffs are noise for a root-cause investigation (skip the patch). */
const SKIP_PATCH = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock)$/;
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|bz2|jar|woff2?|ttf|eot|mp4|mov|wasm|so|dylib|dll|exe|bin)$/i;

export async function getDeployDiff(
  ctx: ToolContext,
  input: GetDeployDiffInput,
): Promise<GetDeployDiffOutput> {
  let base: string;
  let head: string;
  let rawFiles: PinnedDiffFile[];
  let totalAdd: number;
  let totalDel: number;

  if ('sha' in input) {
    const detail = await ctx.octokit.getCommitDiff(input.sha);
    head = detail.sha;
    base = detail.parents[0] ?? '';
    rawFiles = detail.files;
    totalAdd = detail.additions;
    totalDel = detail.deletions;
  } else {
    const cmp = await ctx.octokit.compare(input.base, input.head);
    base = cmp.base_sha;
    head = cmp.head_sha;
    rawFiles = cmp.files;
    totalAdd = cmp.total_additions;
    totalDel = cmp.total_deletions;
  }

  const totalFiles = rawFiles.length;
  let filesTruncated = totalFiles > DIFF_MAX_FILES;
  const kept = rawFiles.slice(0, DIFF_MAX_FILES);

  const files: DiffFile[] = [];
  let runningBytes = 0;
  for (const f of kept) {
    const skip = SKIP_PATCH.test(f.path) || BINARY_EXT.test(f.path) || f.patch === null;
    let patchExcerpt = '';
    if (!skip) {
      const ex = excerptPatch(f.patch);
      patchExcerpt = ex.text;
      if (ex.truncated) filesTruncated = true;
    }
    // Total-payload guard: once we approach 20 KB, stop emitting patch bodies.
    if (runningBytes + byteLength(patchExcerpt) > DIFF_MAX_BYTES) {
      patchExcerpt = '';
      filesTruncated = true;
    }
    runningBytes += byteLength(patchExcerpt);
    files.push({
      path: f.path,
      status: skip ? 'skipped' : f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch_excerpt: patchExcerpt,
    });
  }

  const out: GetDeployDiffOutput = {
    base,
    head,
    total_files: totalFiles,
    total_additions: totalAdd,
    total_deletions: totalDel,
    truncated: filesTruncated,
    files,
  };
  return enforceResultCap(out, 'files');
}

export const getDeployDiffMeta = {
  name: 'get_deploy_diff' as const,
  description:
    'Fetch the real diff for a single commit (input {sha}) or a base..head range (input {base, head}) from the pinned repo. Bounded to 20 files and small patch excerpts; lockfiles/binaries are skipped. Read-only.',
  inputSchema: GetDeployDiffInputSchema,
};
