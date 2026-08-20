import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import type { ReviewResult } from '../../lib/types';
import { CategoryCard } from '../../features/review/components/CategoryCard';
import { ReviewScore } from '../../features/review/components/ReviewScore';
import {
  ScrollReveal,
  ScrollStagger,
  ScrollStaggerItem,
  ScrollWords,
  Parallax,
} from '../../../../components/motion/scroll';
import { MonoTag, HudCorners } from '../../../../components/atmosphere';

/** Hard-coded sample review, rendered through the REAL review components. */
const SAMPLE_REVIEW: ReviewResult = {
  prTitle: 'feat: coupon validation at checkout',
  overallScore: 72,
  categories: [
    {
      name: 'Bugs',
      severity: 'high',
      summary: 'Two logic issues that will surface at runtime.',
      findings: [
        'applyCoupon() dereferences cart.items before the null guard on line 42.',
        'Discount loop uses <= items.length — off-by-one reads past the array.',
      ],
    },
    {
      name: 'Security',
      severity: 'critical',
      summary: 'User input reaches a SQL query without sanitization.',
      findings: [
        'Coupon code is interpolated directly into the lookup query — use a parameterized statement.',
      ],
    },
    {
      name: 'Best Practices',
      severity: 'passed',
      summary: 'Naming, error handling and structure all look solid.',
      findings: [],
    },
  ],
  markdownComment:
    '## Code Review Buddy — 72/100\n\n**Bugs (high)** — 2 findings\n**Security (critical)** — 1 finding\n**Best Practices** — passed',
};

const TOTAL_FINDINGS = SAMPLE_REVIEW.categories.reduce(
  (sum, c) => sum + c.findings.length,
  0,
);
const CRITICAL_COUNT = SAMPLE_REVIEW.categories.filter(
  (c) => c.severity === 'critical',
).length;

/** Live product-screenshot moment — the real review UI floating in space. */
export function ReviewDemo() {
  return (
    <section
      id="demo"
      className="relative flex min-h-screen items-center overflow-hidden px-4 py-32 sm:px-6"
    >
      {/* decorative glow field */}
      <Parallax
        speed={0.18}
        className="pointer-events-none absolute inset-0"
      >
        <div
          aria-hidden
          className="absolute left-1/2 top-24 h-[520px] w-[820px] -translate-x-1/2 rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgba(241,101,36,0.16), transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
        <div
          aria-hidden
          className="absolute bottom-0 right-[-120px] h-[440px] w-[440px] rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgba(187,204,215,0.10), transparent 70%)',
            filter: 'blur(90px)',
          }}
        />
      </Parallax>

      <div className="relative mx-auto w-full max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-white/50">
            <Sparkles size={13} className="text-[#F16524]" />
            Live sample
          </span>
          <div className="mt-6 flex justify-center">
            <MonoTag>LIVE / SAMPLE</MonoTag>
          </div>
          <h2 className="mt-7 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            <ScrollWords
              text="See a review in action"
              className="bg-[linear-gradient(180deg,#646973_0%,#BBCCD7_100%)] bg-clip-text text-transparent"
            />
          </h2>
          <ScrollReveal y={20} delay={0.1} className="mx-auto mt-6 max-w-xl">
            <p className="text-base text-white/50 sm:text-lg">
              A real review of a sample pull request &mdash; scored, severity-tagged
              and ready to paste, exactly what you get for your own code.
            </p>
          </ScrollReveal>
        </div>

        {/* framed product screenshot */}
        <ScrollReveal
          y={48}
          blur
          delay={0.05}
          className="mt-16 [perspective:1600px]"
        >
          <motion.div
            whileHover={{ y: -6 }}
            transition={{ type: 'spring', stiffness: 160, damping: 20 }}
            className="relative overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.03] shadow-[0_50px_140px_-30px_rgba(0,0,0,0.85)] backdrop-blur-xl"
          >
            <HudCorners size={16} inset={16} className="z-20" />
            {/* browser chrome */}
            <div className="flex items-center gap-4 border-b border-white/10 bg-white/[0.02] px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-white/15" />
                <span className="h-3 w-3 rounded-full bg-white/15" />
                <span className="h-3 w-3 rounded-full bg-white/15" />
              </div>
              <div className="mx-auto flex max-w-xs flex-1 items-center justify-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white/40">
                <span className="h-1.5 w-1.5 rounded-full bg-[#F16524]" />
                oncall-ai / code-review
              </div>
              <span className="hidden text-xs font-medium text-white/30 sm:inline">
                AI review
              </span>
            </div>

            {/* review body */}
            <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[280px_1fr]">
              <div className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.02] p-8">
                <ReviewScore score={SAMPLE_REVIEW.overallScore} size="lg" />
                <div className="text-center">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/35">
                    Overall score
                  </p>
                  <p className="mt-2 text-sm font-medium text-white/70">
                    {SAMPLE_REVIEW.prTitle}
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 border-t border-white/10 pt-5 text-xs text-white/45">
                  <div className="flex items-center justify-between">
                    <span>Categories</span>
                    <span className="font-medium text-white/70">
                      {SAMPLE_REVIEW.categories.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Findings</span>
                    <span className="font-medium text-white/70">
                      {TOTAL_FINDINGS}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Critical</span>
                    <span className="font-medium text-white/70">
                      {CRITICAL_COUNT}
                    </span>
                  </div>
                </div>
              </div>

              <ScrollStagger className="flex min-w-0 flex-col gap-4">
                {SAMPLE_REVIEW.categories.map((category) => (
                  <ScrollStaggerItem key={category.name}>
                    <CategoryCard category={category} />
                  </ScrollStaggerItem>
                ))}
              </ScrollStagger>
            </div>
          </motion.div>
        </ScrollReveal>

        <ScrollReveal y={20} delay={0.1} className="mt-12 flex justify-center">
          <Link
            to="/code-review/app"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-3.5 font-medium text-black transition-all duration-200 hover:scale-[1.03] hover:bg-white/90 active:scale-[0.98]"
          >
            Run your own review
            <ArrowUpRight
              size={18}
              className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </Link>
        </ScrollReveal>
      </div>
    </section>
  );
}
