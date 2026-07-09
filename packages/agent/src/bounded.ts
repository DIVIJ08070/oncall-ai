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
/**
 * search_logs: keep only the top-N signature groups (by descending count) in
 * `patterns`. A window with hundreds of DISTINCT `fingerprint_sig` values would
 * otherwise make `patterns[]` unbounded and blow the 12 KB envelope; the whole
 * result is still re-clamped by `enforceResultCap` as a hard backstop.
 */
export const SEARCH_LOGS_MAX_PATTERNS = 50;

/** get_metrics: `series` ≤ 60 points. */
export const METRICS_SERIES_MAX = 60;

/** get_deploy_diff: ≤ 20 files; patch ≤ 100 lines / 4000 chars; total ≤ 20 KB. */
export const DIFF_MAX_FILES = 20;
export const PATCH_MAX_LINES = 100;
export const PATCH_MAX_CHARS = 4000;
export const DIFF_MAX_BYTES = 20 * 1024;

/**
 * read_file: ≤ 400 lines, whichever comes first with the byte cap. The byte cap
 * is set below the 12 KB global envelope (SPEC §9, reconciled to the global cap —
 * no more 16 KB) so the serialized result stays ≤ `RESULT_MAX_BYTES` even after
 * the JSON envelope + string escaping; `enforceResultByteCap` is the hard backstop.
 */
export const READ_FILE_MAX_LINES = 400;
export const READ_FILE_MAX_BYTES = 11 * 1024;

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
 * Enforce the global 12 KB result cap (SPEC §9) over the WHOLE serialized result.
 * If the serialized result exceeds `maxBytes`, trailing elements of the named
 * array field(s) are dropped until the entire envelope fits; when the result
 * carries a `truncated` flag it is set to `true`.
 *
 * Pass a single field for a one-array result (e.g. `'files'`), or a list of every
 * array field for a multi-array result (e.g. `['events', 'patterns']`). Each pass
 * drops tail elements from whichever named array currently contributes the most
 * bytes, so a small-but-informative array (e.g. a signature summary) survives while
 * the dominant payload is trimmed — regardless of which array is the bloated one.
 * This measures the true JSON byte budget across every named array, not just one —
 * the last-resort guarantee the agent never receives > 12 KB from a tool.
 */
export function enforceResultCap<T extends object>(
  result: T,
  arrayFields: keyof T | readonly (keyof T)[],
  maxBytes = RESULT_MAX_BYTES,
): T {
  const requested: readonly (keyof T)[] = Array.isArray(arrayFields)
    ? (arrayFields as readonly (keyof T)[])
    : [arrayFields as keyof T];
  const fields = requested.filter((f) => Array.isArray(result[f]));
  if (fields.length === 0) return result;
  if (byteLength(JSON.stringify(result)) <= maxBytes) return result;

  const hasTruncated = 'truncated' in result;
  const out = { ...result } as Record<PropertyKey, unknown>;
  for (const f of fields) out[f as PropertyKey] = (result[f] as unknown[]).slice();
  const keys = fields.map((f) => f as PropertyKey);

  // Each pass: trim ~10% off the tail of the array that currently costs the most
  // bytes. Terminates because every pass removes ≥1 element from some array.
  while (byteLength(JSON.stringify(out)) > maxBytes) {
    let victim: PropertyKey | null = null;
    let victimBytes = -1;
    for (const key of keys) {
      const arr = out[key] as unknown[];
      if (arr.length === 0) continue;
      const b = byteLength(JSON.stringify(arr));
      if (b > victimBytes) {
        victimBytes = b;
        victim = key;
      }
    }
    if (victim === null) break; // every array is empty — can't shrink further
    const arr = out[victim] as unknown[];
    const drop = Math.max(1, Math.floor(arr.length / 10)); // ~10% per pass
    out[victim] = arr.slice(0, arr.length - drop);
    if (hasTruncated) out.truncated = true;
  }
  return out as T;
}

/**
 * Enforce the global 12 KB result cap when the oversized payload is a single
 * string field (e.g. read_file `content`) rather than an array. Shrinks that
 * field byte-safely until the WHOLE serialized result is ≤ `maxBytes`, then sets
 * `truncated` when a cut was made. Iterates because JSON-escaping the string can
 * inflate its serialized byte cost unpredictably.
 */
export function enforceResultByteCap<T extends object>(
  result: T,
  stringField: keyof T,
  maxBytes = RESULT_MAX_BYTES,
): T {
  const value = result[stringField];
  if (typeof value !== 'string') return result;
  if (byteLength(JSON.stringify(result)) <= maxBytes) return result;

  const hasTruncated = 'truncated' in result;
  const out = { ...result } as Record<PropertyKey, unknown>;
  let text: string = value;
  // Shrink by at least the current overage each pass (with a small margin for the
  // escaping the raw-byte count can't see) until the serialized envelope fits.
  while (text.length > 0 && byteLength(JSON.stringify(out)) > maxBytes) {
    const over = byteLength(JSON.stringify(out)) - maxBytes;
    const target = Math.max(0, byteLength(text) - over - 16);
    text = clampBytes(text, target).text;
    out[stringField as PropertyKey] = text;
    if (hasTruncated) out.truncated = true;
  }
  return out as T;
}
