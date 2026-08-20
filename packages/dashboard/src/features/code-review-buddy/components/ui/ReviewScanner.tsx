import { useEffect, useState } from 'react';
import { severityColor } from './ReviewBadge';

/**
 * ReviewScanner — the loading state for a running review, as a piece of
 * theatre: a block of ghost-code swept top-to-bottom by a glowing scan beam,
 * "bugs" popping up as severity-colored blips, a typewriter status line cycling
 * through what the AI is (plausibly) doing, and a live elapsed timer.
 *
 * All motion is CSS keyframes (they keep running in hidden documents) plus two
 * light intervals; under prefers-reduced-motion it collapses to a calm static
 * "Analyzing…" row so nobody gets a light show they didn't ask for.
 */

const DIFF_MSGS = [
  'parsing the diff',
  'hunting null dereferences',
  'sniffing for code smells',
  'interrogating edge cases',
  'checking what the tests forgot',
  'consulting claude for a second opinion',
  'weighing severity levels',
  'drafting the review comment',
];

const REPO_MSGS = [
  'walking the file tree',
  'short-listing the most suspicious files',
  'reading src/ like a detective',
  'hunting bugs, file by file',
  'cross-examining the test suite',
  'consulting claude about that one function',
  'tallying per-file scores',
  'assembling the verdict',
];

/** Deterministic ghost-code line specs: [indent, seg widths %, bug?]. */
const LINES: Array<{ indent: number; segs: number[]; bug?: 'critical' | 'high' | 'medium' }> = [
  { indent: 0, segs: [12, 24, 8] },
  { indent: 1, segs: [18, 10, 14], bug: 'high' },
  { indent: 1, segs: [8, 30] },
  { indent: 2, segs: [22, 6, 12] },
  { indent: 2, segs: [14, 18], bug: 'critical' },
  { indent: 1, segs: [26, 8] },
  { indent: 0, segs: [10, 16, 10] },
  { indent: 1, segs: [20, 12], bug: 'medium' },
  { indent: 1, segs: [12, 8, 18] },
  { indent: 0, segs: [16, 22] },
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function ReviewScanner({ mode = 'diff' }: { mode?: 'diff' | 'repo' }) {
  const [staticMode] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  const msgs = mode === 'repo' ? REPO_MSGS : DIFF_MSGS;
  const [msgIdx, setMsgIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (staticMode) return;
    const rotate = window.setInterval(() => setMsgIdx((i) => (i + 1) % msgs.length), 2600);
    const tick = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      window.clearInterval(rotate);
      window.clearInterval(tick);
    };
  }, [msgs.length, staticMode]);

  if (staticMode) {
    return (
      <div className="flex items-center gap-3 py-8 text-white/60" role="status">
        <span className="text-sm">Analyzing… this can take a minute.</span>
      </div>
    );
  }

  const patience = elapsed >= 45;

  return (
    <div
      role="status"
      aria-label="Review in progress"
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5"
    >
      {/* header row: mode tag + elapsed */}
      <div className="mb-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#F16524]" />
          {mode === 'repo' ? 'scan // up to 15 files' : 'scan // diff'}
        </span>
        <span className="tabular-nums">
          T+{pad2(Math.floor(elapsed / 60))}:{pad2(elapsed % 60)}
        </span>
      </div>

      {/* ghost code under the scan beam */}
      <div className="crbs-window relative select-none">
        {LINES.map((line, i) => (
          <div
            key={i}
            className="crbs-line flex items-center gap-2 py-[5px]"
            style={{ paddingLeft: line.indent * 18, animationDelay: `${(i * 0.28).toFixed(2)}s` }}
          >
            <span className="w-6 shrink-0 text-right font-mono text-[9px] text-white/20">
              {i + 1}
            </span>
            {line.segs.map((w, j) => (
              <span
                key={j}
                className="h-2 rounded-sm bg-white/[0.09]"
                style={{ width: `${w}%` }}
              />
            ))}
            {line.bug && (
              <span
                className="crbs-blip relative ml-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: severityColor(line.bug),
                  animationDelay: `${(1.2 + i * 0.9).toFixed(2)}s`,
                }}
              >
                <span
                  className="crbs-blip-ring absolute inset-0 rounded-full"
                  style={{
                    boxShadow: `0 0 0 1px ${severityColor(line.bug)}`,
                    animationDelay: `${(1.2 + i * 0.9).toFixed(2)}s`,
                  }}
                />
              </span>
            )}
          </div>
        ))}

        {/* the scan beam */}
        <div aria-hidden className="crbs-beam pointer-events-none absolute inset-x-0 top-0">
          <div className="h-px w-full bg-[#F16524]" />
          <div
            className="h-6 w-full"
            style={{
              background:
                'linear-gradient(to bottom, rgba(241,101,36,0.22), transparent)',
            }}
          />
        </div>
      </div>

      {/* typewriter status line */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="min-w-0 font-mono text-xs text-white/60">
          <span className="text-[#F16524]">&gt; </span>
          <span key={msgIdx} className="crbs-type inline-block align-bottom">
            {msgs[msgIdx]}
          </span>
          <span className="crbs-caret ml-0.5 inline-block h-3.5 w-[7px] translate-y-[2px] bg-[#F16524]" />
        </p>
        {patience && (
          <span className="shrink-0 text-[11px] text-white/35">
            deep review in progress — good reviews take a minute
          </span>
        )}
      </div>
    </div>
  );
}
