import {
  ReadFileInputSchema,
  type ReadFileInput,
  type ReadFileOutput,
} from '@oncall/shared';
import { SafetyViolationError } from '../guards.js';
import type { ToolContext } from '../ports.js';
import { READ_FILE_MAX_BYTES, READ_FILE_MAX_LINES, clampBytes } from '../bounded.js';

/**
 * Tool 5 — `read_file` (SPEC §9). Real file via the pinned client's
 * `getContent`. The path is normalized and `..`/absolute paths are rejected so a
 * read can never escape the pinned repo. Caps: ≤ 400 lines or 16 KB.
 */
export async function readFile(
  ctx: ToolContext,
  input: ReadFileInput,
): Promise<ReadFileOutput> {
  const path = normalizeRepoPath(input.path);
  const file = await ctx.octokit.getFile(path, input.ref);

  const allLines = file.content.split('\n');
  const totalLines = allLines.length;

  // Optional line-range selection (1-based, inclusive).
  const start = input.start_line ? Math.max(1, input.start_line) : 1;
  const end = input.end_line ? Math.min(totalLines, input.end_line) : totalLines;
  const rangeLines = start <= end ? allLines.slice(start - 1, end) : [];

  let truncated = false;
  let lines = rangeLines;
  if (lines.length > READ_FILE_MAX_LINES) {
    lines = lines.slice(0, READ_FILE_MAX_LINES);
    truncated = true;
  }

  let content = lines.join('\n');
  const capped = clampBytes(content, READ_FILE_MAX_BYTES);
  content = capped.text;
  truncated = truncated || capped.truncated;

  return {
    path: file.path,
    ref: file.ref,
    total_lines: totalLines,
    returned_lines: content === '' ? 0 : content.split('\n').length,
    truncated,
    content,
  };
}

/**
 * Reject path traversal / absolute paths and collapse `./` segments so the read
 * stays inside the pinned repo (SPEC §9 read_file: "`..` / absolute paths
 * rejected").
 */
export function normalizeRepoPath(raw: string): string {
  const p = raw.trim().replace(/\\/g, '/');
  if (p.startsWith('/')) {
    throw new SafetyViolationError(`absolute path "${raw}" is not allowed`);
  }
  const segments = p.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) {
    throw new SafetyViolationError(`path traversal "${raw}" is not allowed`);
  }
  const normalized = segments.join('/');
  if (normalized === '') {
    throw new SafetyViolationError('empty path');
  }
  return normalized;
}

export const readFileMeta = {
  name: 'read_file' as const,
  description:
    'Read a file from the pinned repo at an optional ref and line range (real repos.getContent). Bounded to 400 lines or 16 KB. Path traversal and absolute paths are rejected. Read-only.',
  inputSchema: ReadFileInputSchema,
};
