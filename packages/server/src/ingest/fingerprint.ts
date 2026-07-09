/**
 * Log-message signature normalization (SPEC §8 `log_events.fingerprint_sig`,
 * §10.2). Produces the "normalized message signature" precomputed on every log
 * write so the detector's dedup + `search_logs` summarization can group identical
 * errors regardless of variable tokens.
 *
 * Normalization (SPEC §10.2): lowercase; strip digits, UUIDs, hex, and quoted
 * paths/strings. The full incident fingerprint (`sha1(service|detector|dominant_sig)`)
 * is assembled by the detection engine (C5) from the dominant `fingerprint_sig`.
 */

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
// Quoted strings / paths: '...', "...", `...` (with escapes).
const QUOTED_RE = /(['"`])(?:\\.|(?!\1).)*\1/g;
const HEX_LITERAL_RE = /0x[0-9a-f]+/g;
const LONG_HEX_RE = /\b[0-9a-f]{7,}\b/g;
const NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;
const WS_RE = /\s+/g;

/**
 * Normalize a log message to its stable signature. Deterministic and cheap
 * (called on the hot ingest path for every event).
 */
export function normalizeSignature(message: string): string {
  let s = message.toLowerCase();
  s = s.replace(UUID_RE, '<uuid>');
  s = s.replace(QUOTED_RE, '<str>');
  s = s.replace(HEX_LITERAL_RE, '<hex>');
  s = s.replace(LONG_HEX_RE, '<hex>');
  s = s.replace(NUMBER_RE, '<n>');
  s = s.replace(WS_RE, ' ').trim();
  return s;
}
