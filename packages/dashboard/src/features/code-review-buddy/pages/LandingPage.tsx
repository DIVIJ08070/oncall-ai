import { Navbar } from '../components/layout/Navbar';
import { Hero } from '../components/sections/Hero';
import { GitActivityMarquee } from '../components/sections/GitActivityMarquee';
import { ProblemSolution } from '../components/sections/ProblemSolution';
import { Features } from '../components/sections/Features';
import { HowItWorks } from '../components/sections/HowItWorks';
import { ReviewDemo } from '../components/sections/ReviewDemo';
import { CtaFooter } from '../components/sections/CtaFooter';
import { ScrollProgress } from '../../../components/motion/scroll';
import {
  AtmosphereBackdrop,
  Grain,
  Scanlines,
} from '../../../components/atmosphere';

/** Code Review Buddy marketing landing page (route: /code-review). */
export function LandingPage() {
  return (
    <div
      className="relative min-h-screen bg-bg text-ink"
      style={{ overflowX: 'clip' }}
    >
      <ScrollProgress />

      {/* page-wide film grain + phosphor scanlines */}
      <Grain />
      <Scanlines />

      {/* faint fixed phosphor grid behind everything (shared atmosphere) */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <AtmosphereBackdrop />
      </div>

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
