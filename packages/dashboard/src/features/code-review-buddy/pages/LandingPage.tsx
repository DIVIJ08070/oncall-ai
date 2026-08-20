import { Navbar } from '../components/layout/Navbar';
import { Hero } from '../components/sections/Hero';
import { GitActivityMarquee } from '../components/sections/GitActivityMarquee';
import { ProblemSolution } from '../components/sections/ProblemSolution';
import { Features } from '../components/sections/Features';
import { HowItWorks } from '../components/sections/HowItWorks';
import { ReviewDemo } from '../components/sections/ReviewDemo';
import { CtaFooter } from '../components/sections/CtaFooter';
import { ScrollProgress } from '../../../components/motion/scroll';

/** Code Review Buddy marketing landing page (route: /code-review). */
export function LandingPage() {
  return (
    <div
      className="relative min-h-screen bg-[#0C0C0C] text-white"
      style={{ fontFamily: "'Kanit', sans-serif", overflowX: 'clip' }}
    >
      <ScrollProgress />

      {/* faint fixed grid texture behind everything */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '54px 54px',
          maskImage:
            'radial-gradient(ellipse at 50% 0%, black 35%, transparent 82%)',
          WebkitMaskImage:
            'radial-gradient(ellipse at 50% 0%, black 35%, transparent 82%)',
        }}
      />

      <div className="relative z-10">
        <Navbar variant="landing" />
        <Hero />
        <GitActivityMarquee />
        <ProblemSolution />
        <Features />
        <HowItWorks />
        <ReviewDemo />
        <CtaFooter />
      </div>
    </div>
  );
}
