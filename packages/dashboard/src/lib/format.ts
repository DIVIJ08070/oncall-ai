/**
 * Presentation helpers. Timestamps are epoch **ms** (SPEC §7 / DESIGN_SPEC §13):
 * render relative ("12s ago") with the absolute time available on hover/title.
 */

/** Compact relative time from an epoch-ms timestamp. */
export function relativeTime(ts: number | null | undefined, now = Date.now()): string {
  if (ts == null) return '—';
  const diff = Math.max(0, now - ts);
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Absolute ISO-ish local timestamp for `title`/tooltip attributes. */
export function absoluteTime(ts: number | null | undefined): string {
  if (ts == null) return '';
  return new Date(ts).toLocaleString();
}

/** `HH:MM:SS.mmm` clock for dense log rows (DESIGN_SPEC §8.2). */
export function clockMs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(
    d.getMilliseconds(),
    3,
  )}`;
}

/** `HH:MM` for chart x-axis ticks (DESIGN_SPEC §9). */
export function clockHm(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Error rate (0–1) → percent string. */
export function pct(rate: number, digits = 1): string {
  if (!Number.isFinite(rate)) return '0%';
  const v = rate * 100;
  // Whole numbers render without a decimal; small fractions keep one place.
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(digits)}%`;
}

/** Integer-ish milliseconds for latency values. */
export function ms(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}ms`;
}

/** Round req/min to one decimal at most. */
export function perMin(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Confidence (0–1) → percent for the Meter label. */
export function confidencePct(c: number | null | undefined): string {
  if (c == null) return '—';
  return `${Math.round(c * 100)}%`;
}
