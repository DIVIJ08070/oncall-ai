import { Navbar } from '../components/layout/Navbar';
import { Hero } from '../components/sections/Hero';
import { GitActivityMarquee } from '../components/sections/GitActivityMarquee';
import { ProblemSolution } from '../components/sections/ProblemSolution';
import { Features } from '../components/sections/Features';
import { HowItWorks } from '../components/sections/HowItWorks';
import { ReviewDemo } from '../components/sections/ReviewDemo';
import { CtaFooter } from '../components/sections/CtaFooter';
import { ScrollProgress } from '../../../components/motion/scroll';
import { Particles } from '../../../components/atmosphere/Particles';

/** Code Review Buddy marketing landing page (route: /code-review). */
export function LandingPage() {
  return (
    <div
      className="relative min-h-screen bg-[#050505] text-white"
      style={{ fontFamily: "'Kanit', sans-serif", overflowX: 'clip' }}
    >
      <ScrollProgress />

      {/* pure black + drifting particle dust — matches the console */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <Particles
          particleCount={260}
          particleSpread={11}
          speed={0.06}
          particleColors={['#ffffff']}
          alphaParticles
          particleBaseSize={110}
          sizeRandomness={1}
          pixelRatio={1.5}
          className="absolute inset-0"
        />
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
