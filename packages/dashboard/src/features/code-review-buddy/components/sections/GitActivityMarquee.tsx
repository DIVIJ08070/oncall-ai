import {
  Bug,
  Check,
  GitCommit,
  GitMerge,
  GitPullRequest,
  ShieldAlert,
  TestTube2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Severity } from '../../lib/types';
import { severityColor } from '../ui';
import { ScrollReveal } from '../../../../components/motion/scroll';

interface Chip {
  icon: LucideIcon;
  text: string;
  severity: Severity;
}

const ROW_A: Chip[] = [
  { icon: ShieldAlert, text: 'security: SQL injection caught', severity: 'critical' },
  { icon: GitPullRequest, text: 'PR #142 scored 87/100', severity: 'passed' },
  { icon: Bug, text: 'bug: off-by-one in pagination', severity: 'high' },
  { icon: GitCommit, text: 'fix: null check in checkout · 2 findings', severity: 'medium' },
  { icon: TestTube2, text: 'missing tests: payment retry path', severity: 'medium' },
  { icon: GitMerge, text: 'PR #98 merged after fixes · 94/100', severity: 'passed' },
];

const ROW_B: Chip[] = [
  { icon: Bug, text: 'bug: unhandled promise rejection', severity: 'critical' },
  { icon: ShieldAlert, text: 'security: hardcoded token flagged', severity: 'high' },
  { icon: GitPullRequest, text: 'PR #201 · 3 code smells tagged', severity: 'low' },
  { icon: GitCommit, text: 'refactor: extracted duplicate mapper', severity: 'low' },
  { icon: Check, text: 'style: passed all custom rules', severity: 'passed' },
  { icon: TestTube2, text: 'coverage gap: auth middleware', severity: 'medium' },
];

const MARQUEE_CSS = `
@keyframes crb-marquee-left {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
@keyframes crb-marquee-right {
  from { transform: translateX(-50%); }
  to { transform: translateX(0); }
}
.crb-track-left { animation: crb-marquee-left 44s linear infinite; }
.crb-track-right { animation: crb-marquee-right 54s linear infinite; }
.crb-marquee:hover .crb-track-left,
.crb-marquee:hover .crb-track-right { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .crb-track-left, .crb-track-right { animation: none; }
}
`;

function ChipPill({ chip }: { chip: Chip }) {
  const color = severityColor(chip.severity);
  return (
    <span className="mx-2.5 inline-flex shrink-0 items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/60 backdrop-blur transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.07]">
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
      <chip.icon size={14} className="shrink-0 text-white/40" />
      {chip.text}
    </span>
  );
}

function ChipRow({ chips, hidden }: { chips: Chip[]; hidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={hidden}>
      {chips.map((chip, i) => (
        <ChipPill key={`${chip.text}-${i}`} chip={chip} />
      ))}
    </div>
  );
}

/** Infinite dual-row marquee of fake git activity; opposite directions, pauses on hover. */
export function GitActivityMarquee() {
  return (
    <ScrollReveal className="crb-marquee relative overflow-hidden border-y border-white/5 py-8">
      <style>{MARQUEE_CSS}</style>
      <div
        className="flex flex-col gap-4"
        style={{
          maskImage:
            'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)',
          WebkitMaskImage:
            'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)',
        }}
      >
        <div className="crb-track-left flex w-max">
          <ChipRow chips={ROW_A} />
          <ChipRow chips={ROW_A} hidden />
        </div>
        <div className="crb-track-right flex w-max">
          <ChipRow chips={ROW_B} />
          <ChipRow chips={ROW_B} hidden />
        </div>
      </div>
    </ScrollReveal>
  );
}
