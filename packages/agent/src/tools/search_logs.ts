import {
  SearchLogsInputSchema,
  type SearchLogsInput,
  type SearchLogsOutput,
  type SearchLogsEvent,
} from '@oncall/shared';
import type { ToolContext, ToolLogRow } from '../ports.js';
import {
  SEARCH_LOGS_MAX_PATTERNS,
  SEARCH_LOGS_MAX_ROWS,
  SEARCH_LOGS_SCAN_LIMIT,
  STACK_EXCERPT_MAX_CHARS,
  clampChars,
  enforceResultCap,
  summarizeBySignature,
} from '../bounded.js';

/**
 * Tool 1 — `search_logs` (SPEC §9). Reads `log_events` for the pinned incident's
 * customer. Indexed filters (service/level/since/until) hit the DB; `query`,
 * `endpoint`, and `status` are applied in-memory over a bounded scan. Returns ≤
 * 50 rows; the remainder is summarized by `fingerprint_sig` into `patterns`.
 */
export async function searchLogs(
  ctx: ToolContext,
  input: SearchLogsInput,
): Promise<SearchLogsOutput> {
  const limit = Math.min(input.limit, SEARCH_LOGS_MAX_ROWS);

  // Pull a bounded scan using the indexed columns; refine the rest in memory.
  const scanned = ctx.db.dao.logEvents.query({
    customer_id: ctx.customer.id,
    service: input.service,
    level: input.level,
    since: input.since,
    until: input.until,
    limit: SEARCH_LOGS_SCAN_LIMIT,
  });

  const q = input.query?.toLowerCase();
  const matched = scanned.filter((r) => {
    if (input.endpoint !== undefined && r.endpoint !== input.endpoint) return false;
    if (input.status !== undefined && r.status !== input.status) return false;
    if (q !== undefined && !r.message.toLowerCase().includes(q)) return false;
    return true;
  });

  const returned = matched.slice(0, limit);
  const remainder = matched.slice(limit);

  const events: SearchLogsEvent[] = returned.map((r) => toEvent(r));

  // Summarize the remainder by signature, then keep only the top-N groups (by
  // descending count) so `patterns[]` can't grow unbounded with many distinct
  // `fingerprint_sig` values (BUG-007). `summarizeBySignature` already sorts by
  // count desc, so a prefix slice is the top-N.
  const allPatterns = summarizeBySignature(
    remainder.map((r) => ({ signature: r.fingerprint_sig, sample: r.message })),
  );
  const patterns = allPatterns.slice(0, SEARCH_LOGS_MAX_PATTERNS);
  const patternsTruncated = allPatterns.length > patterns.length;

  const scanTruncated = scanned.length >= SEARCH_LOGS_SCAN_LIMIT;
  const out: SearchLogsOutput = {
    total_matched: matched.length,
    returned: events.length,
    truncated: remainder.length > 0 || scanTruncated || patternsTruncated,
    events,
    patterns,
  };
  // Whole-result 12 KB backstop (NFR-07): enforce the byte budget over the FULL
  // envelope (both arrays), trimming whichever of `events`/`patterns` currently
  // dominates the byte count so neither array can blow the cap on its own.
  return enforceResultCap(out, ['events', 'patterns']);
}

function toEvent(r: ToolLogRow): SearchLogsEvent {
  return {
    ts: r.timestamp,
    level: r.level,
    message: r.message,
    endpoint: r.endpoint,
    status: r.status,
    latency_ms: r.latency_ms,
    stack_excerpt:
      r.stack === null || r.stack === undefined
        ? null
        : clampChars(r.stack, STACK_EXCERPT_MAX_CHARS),
  };
}

export const searchLogsMeta = {
  name: 'search_logs' as const,
  description:
    'Search the incident customer\'s recent log_events by service/level/endpoint/status/text and time window. Returns up to 50 matching rows plus a signature summary of the remainder. Read-only.',
  inputSchema: SearchLogsInputSchema,
};
