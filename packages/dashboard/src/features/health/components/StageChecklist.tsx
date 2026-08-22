import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { GlassCard, MONO } from '../../../components/shell/UnifiedChrome';

/**
 * StageChecklist — the running-state analysis stages as an animated checklist.
 * Progression is cosmetic (elapsed-time thresholds tuned to a 1-3 min job),
 * EXCEPT the final stage: it keeps spinning until the job really reports
 * `done` (the page unmounts this component at that point).
 */

export const STAGES = [
  'Cloning repository',
  'Scanning structure',
  'Mapping APIs',
  'Checking databases',
  'AI code review',
  'Writing report',
] as const;

/** Seconds of elapsed time after which stage i (0..4) shows as complete. */
const STAGE_DONE_AT_S = [5, 12, 21, 32, 70];

export function StageChecklist({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsedS = Math.max(0, (now - startedAt) / 1000);
  // First stage whose threshold hasn't passed; the last stage has no
  // threshold, so it stays active until status=done ends the running state.
  let active = STAGE_DONE_AT_S.findIndex((t) => elapsedS < t);
  if (active === -1) active = STAGES.length - 1;

  return (
    <GlassCard className="w-full max-w-md p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span
          className="text-[10px] uppercase tracking-[0.2em] text-white/40"
          style={{ fontFamily: MONO }}
        >
          Analyzing
        </span>
        <span
          className="text-[10px] tabular-nums text-[#FF8233]"
          style={{ fontFamily: MONO }}
        >
          {formatElapsed(elapsedS)}
        </span>
      </div>
      <ul className="flex flex-col gap-3.5">
        {STAGES.map((label, i) => {
          const state = i < active ? 'done' : i === active ? 'active' : 'pending';
          return (
            <li key={label} className="flex items-center gap-3">
              {state === 'done' ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#52D273]/15">
                  <Check className="h-3 w-3 text-[#52D273]" strokeWidth={3} />
                </span>
              ) : state === 'active' ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-[#FF8233]" />
                </span>
              ) : (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                </span>
              )}
              <span
                className={`text-sm transition-colors ${
                  state === 'done'
                    ? 'text-white/45 line-through decoration-white/20'
                    : state === 'active'
                      ? 'font-medium text-white'
                      : 'text-white/35'
                }`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-5 text-[11px] leading-relaxed text-white/35">
        Full analysis usually takes 1–3 minutes. You can keep this tab open —
        the report appears here the moment it's ready.
      </p>
    </GlassCard>
  );
}

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
