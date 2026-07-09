import { confidencePct } from '../../lib/format';
import { v } from '../../lib/tokens';

/**
 * Confidence Meter (DESIGN_SPEC §7). 6px track `--surface-3`, fill = `confidence`
 * (0–1) in `--accent`; label right "92%". Below `AGENT_CONFIDENCE_THRESHOLD` (0.6)
 * the fill turns `--warn` and a "low confidence" chip appears. `role="progressbar"`.
 */

/** FR-13 escalation gate (SPEC §14 `AGENT_CONFIDENCE_THRESHOLD`) — display mirror. */
export const CONFIDENCE_THRESHOLD = 0.6;

export function Meter({
  confidence,
  className = '',
  showLowChip = true,
}: {
  confidence: number | null | undefined;
  className?: string;
  showLowChip?: boolean;
}) {
  const c = confidence == null ? null : Math.max(0, Math.min(1, confidence));
  const low = c != null && c < CONFIDENCE_THRESHOLD;
  const fillToken = low ? 'warn' : 'accent';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        role="progressbar"
        aria-valuenow={c ?? undefined}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-label="Agent confidence"
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-3"
      >
        <div
          className="h-full rounded-pill transition-[width] duration-base"
          style={{
            width: `${(c ?? 0) * 100}%`,
            backgroundColor: v(fillToken),
          }}
        />
      </div>
      <span className="tabular shrink-0 text-sm text-ink">{confidencePct(c)}</span>
      {low && showLowChip ? (
        <span
          className="shrink-0 rounded-pill px-2 py-0.5 text-label uppercase text-ink"
          style={{ backgroundColor: `color-mix(in srgb, ${v('warn')} 14%, transparent)` }}
        >
          low confidence
        </span>
      ) : null}
    </div>
  );
}
