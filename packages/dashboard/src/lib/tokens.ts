/**
 * Token helpers. Components never hardcode hex (DESIGN_SPEC §14) — they reference
 * CSS custom properties. Tinted surfaces (status pills, breach washes, feed
 * accents) use `color-mix` so a single token drives both the solid mark and its
 * low-opacity fill without duplicating RGB channels.
 */

/** `var(--name)`. */
export function v(name: string): string {
  return `var(--${name})`;
}

/** A translucent wash of a token: `color-mix(in srgb, var(--x) N%, transparent)`. */
export function tint(name: string, percent: number): string {
  return `color-mix(in srgb, var(--${name}) ${percent}%, transparent)`;
}
