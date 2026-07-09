import { describe, it, expect } from 'vitest';
import {
  RESULT_MAX_BYTES,
  byteLength,
  clampBytes,
  clampChars,
  enforceResultCap,
  excerptPatch,
  summarizeBySignature,
} from '../src/bounded.js';

describe('bounded — char/byte caps', () => {
  it('clampChars truncates long strings with a marker', () => {
    const s = 'x'.repeat(5000);
    const out = clampChars(s, 1200);
    expect(out.length).toBeLessThanOrEqual(1200);
    expect(out).toContain('truncated');
  });

  it('clampChars leaves short strings intact', () => {
    expect(clampChars('hello', 1200)).toBe('hello');
  });

  it('clampBytes caps UTF-8 bytes on a safe boundary', () => {
    const s = '€'.repeat(10000); // 3 bytes each
    const { text, truncated } = clampBytes(s, 16 * 1024);
    expect(truncated).toBe(true);
    expect(byteLength(text)).toBeLessThanOrEqual(16 * 1024);
    // no replacement chars from a split multibyte tail
    expect(text).not.toContain('�');
  });

  it('excerptPatch caps to 100 lines / 4000 chars', () => {
    const patch = Array.from({ length: 500 }, (_, i) => `+ line ${i}`).join('\n');
    const { text, truncated } = excerptPatch(patch);
    expect(truncated).toBe(true);
    expect(text.split('\n').length).toBeLessThanOrEqual(101); // 100 + marker line
    expect(text).toContain('more lines');
  });

  it('excerptPatch passes through short patches untouched', () => {
    const { text, truncated } = excerptPatch('+a\n-b');
    expect(truncated).toBe(false);
    expect(text).toBe('+a\n-b');
  });
});

describe('bounded — repetitive-error summarization', () => {
  it('collapses identical signatures into {signature,count,sample} by count desc', () => {
    const rows = [
      { signature: 'null deref <str>', sample: 'Cannot read a' },
      { signature: 'null deref <str>', sample: 'Cannot read b' },
      { signature: 'null deref <str>', sample: 'Cannot read c' },
      { signature: 'timeout <n>', sample: 'timeout 30' },
    ];
    const out = summarizeBySignature(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ signature: 'null deref <str>', count: 3 });
    expect(out[1]).toMatchObject({ signature: 'timeout <n>', count: 1 });
  });

  it('keeps unsignatured rows separate (never silently dropped)', () => {
    const out = summarizeBySignature([
      { signature: null, sample: 'weird one' },
      { signature: '', sample: 'weird two' },
    ]);
    expect(out.map((p) => p.count).reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe('bounded — 12KB global cap', () => {
  it('trims the named array until the result is under 12KB and flags truncated', () => {
    const events = Array.from({ length: 2000 }, (_, i) => ({
      ts: i,
      message: 'x'.repeat(200),
    }));
    const result = { total: events.length, truncated: false, events };
    const capped = enforceResultCap(result, 'events');
    expect(byteLength(JSON.stringify(capped))).toBeLessThanOrEqual(RESULT_MAX_BYTES);
    expect(capped.truncated).toBe(true);
    expect(capped.events.length).toBeLessThan(events.length);
  });

  it('leaves small results (and their truncated flag) untouched', () => {
    const result = { truncated: false, items: [1, 2, 3] };
    expect(enforceResultCap(result, 'items')).toEqual(result);
  });

  it('caps arrays even when the result has no truncated field', () => {
    const result = { rows: Array.from({ length: 5000 }, () => 'y'.repeat(50)) };
    const capped = enforceResultCap(result, 'rows');
    expect(byteLength(JSON.stringify(capped))).toBeLessThanOrEqual(RESULT_MAX_BYTES);
  });
});
