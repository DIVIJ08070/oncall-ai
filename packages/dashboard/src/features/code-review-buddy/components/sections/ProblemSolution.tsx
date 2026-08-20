import { CheckCircle2, Clock3, XCircle, Zap } from 'lucide-react';
import type { Severity } from '../../lib/types';
import { ReviewBadge } from '../ui';
import {
  Parallax,
  ScrollReveal,
  ScrollStagger,
  ScrollStaggerItem,
  ScrollWords,
} from '../../../../components/motion/scroll';
import { MonoTag, HudCorners } from '../../../../components/atmosphere';

const PROBLEMS = [
  'Human review is slow — PRs sit for hours or days waiting for eyes.',
  'Tired reviewers miss the bugs that matter most.',
  'Nitpicks about style crowd out real issues in the comments.',
];

const SOLUTIONS = [
  'Instant structured review, seconds after you paste a diff.',
  'Every finding severity-tagged, from critical to passed.',
  'Your own team rules enforced alongside the built-in checks.',
  'A 0-100 score you can gate merges on.',
];

const BADGES: Severity[] = ['critical', 'high', 'medium', 'low', 'passed'];

/** Tall two-panel moment contrasting slow human review with Code Review Buddy. */
export function ProblemSolution() {
  return (
    <section className="relative overflow-hidden px-4 py-32 sm:px-6 md:py-40">
      <Parallax
        speed={0.2}
        className="pointer-events-none absolute right-[-160px] top-1/4 z-0 h-[520px] w-[520px]"
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgba(241,101,36,0.18), transparent 70%)',
            filter: 'blur(110px)',
          }}
        />
      </Parallax>
      <Parallax
        speed={0.14}
        className="pointer-events-none absolute left-[-160px] bottom-0 z-0 h-[420px] w-[420px]"
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgba(187,204,215,0.12), transparent 70%)',
            filter: 'blur(110px)',
          }}
        />
      </Parallax>

      <div className="relative z-10 mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <ScrollReveal y={16}>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.22em] text-white/55 backdrop-blur">
              The shift
            </span>
          </ScrollReveal>

          <div className="mt-6 flex justify-center">
            <MonoTag>WHY / CONTRAST</MonoTag>
          </div>

          <h2 className="mt-6 text-4xl font-black uppercase leading-[0.95] tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl">
            <ScrollWords
              text="SHIP WITHOUT THE WAIT"
              className="bg-[linear-gradient(180deg,#646973_0%,#BBCCD7_100%)] bg-clip-text text-transparent"
            />
          </h2>

          <ScrollReveal y={20} blur delay={0.3} className="mx-auto mt-6 max-w-xl">
            <p className="text-base text-white/55 sm:text-lg">
              Human review is a bottleneck. Code Review Buddy makes the first
              pass instant, structured, and impossible to skim past.
            </p>
          </ScrollReveal>
        </div>

        <ScrollStagger className="relative mt-16 grid gap-6 md:mt-20 md:grid-cols-2 md:gap-0">
          {/* Glowing divider */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-6 bottom-6 z-10 hidden w-px -translate-x-1/2 md:block"
            style={{
              background:
                'linear-gradient(180deg, transparent, rgba(241,101,36,0.55), rgba(255,130,51,0.35), transparent)',
              boxShadow: '0 0 24px rgba(241,101,36,0.35)',
            }}
          />

          {/* Problem — muted */}
          <ScrollStaggerItem className="md:pr-10">
            <div className="relative h-full rounded-3xl border border-white/10 bg-white/[0.02] p-8 backdrop-blur md:p-10">
              <HudCorners size={14} inset={14} color="rgba(255,255,255,0.22)" />
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/40">
                  <Clock3 size={18} />
                </span>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/35">
                    Today
                  </p>
                  <h3 className="text-xl font-semibold text-white/70">
                    The problem
                  </h3>
                </div>
              </div>
              <ul className="mt-8 space-y-5">
                {PROBLEMS.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-white/45"
                  >
                    <XCircle
                      size={18}
                      className="mt-0.5 shrink-0 text-white/25"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </ScrollStaggerItem>

          {/* Solution — orange-accented */}
          <ScrollStaggerItem className="md:pl-10">
            <div
              className="relative h-full rounded-3xl border p-8 backdrop-blur md:p-10"
              style={{
                borderColor: 'rgba(241,101,36,0.28)',
                background:
                  'linear-gradient(180deg, rgba(241,101,36,0.08), rgba(255,255,255,0.02))',
                boxShadow: '0 0 60px -24px rgba(241,101,36,0.45)',
              }}
            >
              <HudCorners size={14} inset={14} />
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{
                    color: '#F16524',
                    borderWidth: 1,
                    borderColor: 'rgba(241,101,36,0.35)',
                    backgroundColor: 'rgba(241,101,36,0.12)',
                  }}
                >
                  <Zap size={18} />
                </span>
                <div>
                  <p
                    className="text-[11px] font-medium uppercase tracking-[0.2em]"
                    style={{ color: '#FF8233' }}
                  >
                    With Code Review Buddy
                  </p>
                  <h3 className="text-xl font-semibold text-white">
                    Instant, structured review
                  </h3>
                </div>
              </div>
              <ul className="mt-8 space-y-5">
                {SOLUTIONS.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-white/80"
                  >
                    <CheckCircle2
                      size={18}
                      className="mt-0.5 shrink-0"
                      style={{ color: '#F16524' }}
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-2 border-t border-white/10 pt-6">
                {BADGES.map((severity) => (
                  <ReviewBadge key={severity} severity={severity} />
                ))}
              </div>
            </div>
          </ScrollStaggerItem>
        </ScrollStagger>
      </div>
    </section>
  );
}
