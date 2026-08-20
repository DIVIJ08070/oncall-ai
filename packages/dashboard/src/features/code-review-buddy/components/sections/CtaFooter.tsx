import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Footer } from '../layout/Footer';
import {
  ScrollReveal,
  ScrollWords,
  Parallax,
} from '../../../../components/motion/scroll';

/** Giant closing moment, then the shared mini-app footer. */
export function CtaFooter() {
  return (
    <section id="contact" className="relative overflow-hidden">
      {/* layered parallax glow */}
      <Parallax speed={0.22} className="pointer-events-none absolute inset-0">
        <div
          aria-hidden
          className="absolute left-1/2 top-[8%] h-[560px] w-[900px] -translate-x-1/2 rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgba(241,101,36,0.18), transparent 70%)',
            filter: 'blur(90px)',
          }}
        />
      </Parallax>
      <Parallax speed={0.12} className="pointer-events-none absolute inset-0">
        <div
          aria-hidden
          className="absolute bottom-[6%] left-[10%] h-[420px] w-[520px] rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgba(187,204,215,0.12), transparent 70%)',
            filter: 'blur(100px)',
          }}
        />
      </Parallax>

      <div className="relative mx-auto flex min-h-[86vh] max-w-4xl flex-col items-center justify-center px-4 py-40 text-center sm:px-6">
        <ScrollReveal y={16} className="mb-9">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-medium uppercase tracking-[0.2em] text-white/50">
            <span className="h-1.5 w-1.5 rounded-full bg-[#F16524]" />
            Ready when you are
          </span>
        </ScrollReveal>

        <h2 className="pb-2 text-6xl font-black leading-[1.03] tracking-tight sm:text-7xl md:text-8xl">
          <ScrollWords
            text="Ship with confidence."
            className="bg-[linear-gradient(180deg,#646973_0%,#BBCCD7_100%)] bg-clip-text text-transparent"
          />
        </h2>

        <ScrollReveal y={22} delay={0.15} className="mt-8 max-w-xl">
          <p className="text-lg text-white/55">
            Paste a diff and get a structured, severity-tagged review in seconds
            &mdash; every bug, risk and missing test caught before a human opens
            the PR.
          </p>
        </ScrollReveal>

        <ScrollReveal
          y={22}
          delay={0.25}
          className="mt-12 flex flex-col items-center gap-5 sm:flex-row"
        >
          <Link
            to="/code-review/app"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-9 py-4 text-lg font-medium text-black transition-all duration-200 hover:scale-[1.03] hover:bg-white/90 active:scale-[0.98]"
          >
            Review my code
            <ArrowUpRight
              size={20}
              className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full px-6 py-4 text-lg font-medium text-white/60 transition-colors duration-200 hover:text-white"
          >
            Back to OnCall AI
          </Link>
        </ScrollReveal>
      </div>

      <Footer />
    </section>
  );
}
