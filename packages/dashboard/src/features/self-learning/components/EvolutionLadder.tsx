import { Check, Crown, Eye, GitBranch, Lock, Network, Target, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LearningLevel } from '../../../api/learnings';
import { GlassCard, MONO } from '../../../components/shell/UnifiedChrome';

/**
 * EvolutionLadder — the six-level growth ladder rendered TOP-DOWN (ORACLE →
 * OBSERVER). Levels below the current one are completed (green check), the
 * current one gets an orange ring + chip, levels above are locked and show
 * their unlock threshold. Thresholds mirror the server's level table.
 */

const ORANGE = '#F16524';
const ORANGE_HI = '#FF8233';
const GREEN = '#52D273';

interface LadderLevel {
  index: number;
  name: string;
  at: number;
  icon: LucideIcon;
  desc: string;
}

/** Top-down: ORACLE first. */
const LADDER: LadderLevel[] = [
  { index: 5, name: 'ORACLE', at: 100, icon: Crown, desc: 'A living mind — anticipates failures before they fire.' },
  { index: 4, name: 'VETERAN', at: 60, icon: Zap, desc: 'Constellations pulse; fixes land on instinct.' },
  { index: 3, name: 'SPECIALIST', at: 30, icon: Target, desc: 'Dense pathways form along proven fixes.' },
  { index: 2, name: 'RESIDENT', at: 15, icon: Network, desc: 'Clusters form around recurring error classes.' },
  { index: 1, name: 'APPRENTICE', at: 5, icon: GitBranch, desc: 'First synapses connect; neurons begin to fire.' },
  { index: 0, name: 'OBSERVER', at: 0, icon: Eye, desc: 'A newborn core waiting for its first signal.' },
];

export function EvolutionLadder({ level }: { level: LearningLevel }) {
  return (
    <GlassCard className="p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span
          className="text-[10px] uppercase tracking-[0.18em] text-white/40"
          style={{ fontFamily: MONO }}
        >
          Evolution Level
        </span>
        <span
          className="text-[10px] tabular-nums text-white/30"
          style={{ fontFamily: MONO }}
        >
          {level.nextAt != null ? `${level.total} / next at ${level.nextAt}` : 'max level'}
        </span>
      </div>
      <ol className="flex flex-col gap-1.5 pt-2">
        {LADDER.map((lv) => {
          const state =
            lv.index === level.index
              ? ('current' as const)
              : lv.index < level.index
                ? ('done' as const)
                : ('locked' as const);
          const IconCmp = state === 'done' ? Check : state === 'locked' ? Lock : lv.icon;
          return (
            <li
              key={lv.name}
              data-ladder-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
              className={`flex items-start gap-2.5 rounded-xl border p-2.5 ${
                state === 'current'
                  ? 'border-[#F16524]/35 bg-[#F16524]/[0.08] ring-1 ring-inset ring-[#F16524]/30'
                  : 'border-transparent'
              } ${state === 'locked' ? 'opacity-55' : ''}`}
            >
              <span
                aria-hidden
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={
                  state === 'done'
                    ? { backgroundColor: `${GREEN}1F`, color: GREEN, border: `1px solid ${GREEN}4D` }
                    : state === 'current'
                      ? {
                          backgroundColor: `${ORANGE}2E`,
                          color: ORANGE_HI,
                          boxShadow: `0 0 0 2px ${ORANGE}59`,
                        }
                      : {
                          backgroundColor: 'rgba(255,255,255,0.05)',
                          color: 'rgba(255,255,255,0.3)',
                        }
                }
              >
                <IconCmp className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`text-[11px] tracking-[0.14em] ${
                      state === 'locked' ? 'text-white/40' : 'text-[#F5F5F2]'
                    }`}
                    style={{ fontFamily: MONO }}
                  >
                    Level {lv.index} · {lv.name}
                  </span>
                  {state === 'current' && (
                    <span
                      className="rounded-full border border-[#F16524]/40 bg-[#F16524]/20 px-1.5 py-px text-[9px] uppercase tracking-[0.14em] text-[#FF8233]"
                      style={{ fontFamily: MONO }}
                    >
                      Current
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-white/45">{lv.desc}</p>
                <p
                  className="mt-0.5 text-[9px] tabular-nums text-white/30"
                  style={{ fontFamily: MONO }}
                >
                  {state === 'locked'
                    ? `unlocks at ${lv.at} learnings`
                    : state === 'done'
                      ? `unlocked at ${lv.at} learnings`
                      : `${level.total} learnings`}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </GlassCard>
  );
}
