import type { OncallDb } from '../db/index.js';
import type { CustomerRow } from '../db/rows.js';

/**
 * Per-customer ingest key auth (SPEC §7.1, FR-01). The `x-ingest-key` header is
 * matched against `customers.ingest_api_key` (UNIQUE). No key / unknown key →
 * unauthorized (the route returns `401`).
 */

export const INGEST_KEY_HEADER = 'x-ingest-key';

/** Normalize a possibly-array header value to a single string (or null). */
export function extractIngestKey(
  headerValue: string | string[] | undefined,
): string | null {
  if (Array.isArray(headerValue)) return headerValue[0] ?? null;
  return headerValue ?? null;
}

/** Resolve the owning customer for an ingest key, or `null` if unauthenticated. */
export function authenticateIngest(
  db: OncallDb,
  key: string | null,
): CustomerRow | null {
  if (!key) return null;
  return db.dao.customers.getByIngestKey(key);
}
