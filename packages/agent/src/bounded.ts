import type { LogPattern } from '@oncall/shared';

/**
 * Bounded-output rules (SPEC §9 "Bounded-output rules", NFR-07 ≤ $0.25).
 *
 * The agent must never receive an unbounded tool result: every tool output is
 * capped in rows, characters, and total JSON bytes, and long tails of identical
 * errors are collapsed into `{ signature, count, sample }`. These helpers are
 * the single place those caps live so every tool applies them identically.
 */

/* ── Global + per-tool caps (SPEC §9) ─────────────────────────────────────── */

/** Any single tool result ≤ 12 KB JSON (SPEC §9 global cap). */
export const RESULT_MAX_BYTES = 12 * 1024;

/** search_logs: ≤ 50 rows; `stack_excerpt` ≤ 1200 chars. */
export const SEARCH_LOGS_MAX_ROWS = 50;
export const STACK_EXCERPT_MAX_CHARS = 1200;
/** Bounded scan the tool reads before summarizing the remainder. */
export const SEARCH_LOGS_SCAN_LIMIT = 500;

/** get_metrics: `series` ≤ 60 points. */
export const METRICS_SERIES_MAX = 60;

/** get_deploy_diff: ≤ 20 files; patch ≤ 100 lines / 4000 chars; total ≤ 20 KB. */
export const DIFF_MAX_FILES = 20;
export const PATCH_MAX_LINES = 100;
export const PATCH_MAX_CHARS = 4000;
export const DIFF_MAX_BYTES = 20 * 1024;

/** read_file: ≤ 400 lines or 16 KB, whichever first. */
export const READ_FILE_MAX_LINES = 400;
export const READ_FILE_MAX_BYTES = 16 * 1024;

/** get_recent_deploys: ≤ 20 commits. */
export const RECENT_DEPLOYS_MAX = 20;

/* ── primitive byte/char helpers ──────────────────────────────────────────── */

export function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** Truncate to at most `maxChars` characters, appending a marker when cut. */
export function clampChars(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  const marker = `\n… [truncated ${s.length - maxChars} chars]`;
  const keep = Math.max(0, maxChars - marker.length);
  return s.slice(0, keep) + marker;
}

/** Truncate to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function clampBytes(
  s: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return { text: s, truncated: false };
  // Back off the cut point off any UTF-8 continuation byte (0b10xxxxxx) so we
  // land on a code-point boundary — otherwise `toString` appends a 3-byte U+FFFD
  // replacement char and the result can *exceed* maxBytes.
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return { text: buf.subarray(0, end).toString('utf8'), truncated: true };
}

/**
 * Excerpt a unified-diff patch to ≤ `maxLines` and ≤ `maxChars` (SPEC §9
 * get_deploy_diff). Returns the excerpt + whether it was cut.
 */
export function excerptPatch(
  patch: string | null | undefined,
  maxLines = PATCH_MAX_LINES,
  maxChars = PATCH_MAX_CHARS,
): { text: string; truncated: boolean } {
  if (patch === null || patch === undefined || patch === '') {
    return { text: '', truncated: false };
  }
  let truncated = false;
  const lines = patch.split('\n');
  let text = patch;
  if (lines.length > maxLines) {
    text = lines.slice(0, maxLines).join('\n') + `\n… [+${lines.length - maxLines} more lines]`;
    truncated = true;
  }
  if (text.length > maxChars) {
    text = clampChars(text, maxChars);
    truncated = true;
  }
  return { text, truncated };
}

/* ── repetitive-error summarization (SPEC §9) ─────────────────────────────── */

/** Something summarizable by a normalized signature. */
export interface Signable {
  /** Normalized fingerprint signature (`log_events.fingerprint_sig`, §10.2). */
  signature: string | null | undefined;
  /** The human-readable sample to keep as the exemplar. */
  sample: string;
}

/**
 * Collapse a list of rows into `{ signature, count, sample }` groups ordered by
 * descending count (SPEC §9: "identical `fingerprint_sig` rows are collapsed").
 * Rows with no signature are grouped under their own sample text so nothing is
 * silently dropped.
 */
export function summarizeBySignature(rows: readonly Signable[]): LogPattern[] {
  const groups = new Map<string, { count: number; sample: string }>();
  for (const r of rows) {
    const key = r.signature && r.signature.length > 0 ? r.signature : `raw:${r.sample}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { count: 1, sample: r.sample });
  }
  return [...groups.entries()]
    .map(([signature, g]) => ({
      signature: signature.startsWith('raw:') ? signature.slice(4) : signature,
      count: g.count,
      sample: clampChars(g.sample, 200),
    }))
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));
}

/* ── final safety net: 12 KB JSON cap ─────────────────────────────────────── */

/**
 * Enforce the global 12 KB result cap (SPEC §9). If the serialized result
 * exceeds `maxBytes`, trailing elements of the named array field are dropped
 * until it fits; when the result carries a `truncated` flag it is set to `true`.
 * Per-tool caps normally keep results well under this; this is the last-resort
 * guarantee the agent never receives > 12 KB from a tool.
 */
export function enforceResultCap<T extends object>(
  result: T,
  arrayField: keyof T,
  maxBytes = RESULT_MAX_BYTES,
): T {
  const arr = result[arrayField];
  if (!Array.isArray(arr)) return result;
  if (byteLength(JSON.stringify(result)) <= maxBytes) return result;

  const hasTruncated = 'truncated' in result;
  let items = arr.slice();
  let out = { ...result, [arrayField]: items } as T;

  // Drop from the tail until it fits (or the array is empty).
  while (items.length > 0 && byteLength(JSON.stringify(out)) > maxBytes) {
    const drop = Math.max(1, Math.floor(items.length / 10)); // ~10% per pass
    items = items.slice(0, items.length - drop);
    out = { ...result, [arrayField]: items } as T;
    if (hasTruncated) (out as Record<string, unknown>).truncated = true;
  }
  return out;
}
