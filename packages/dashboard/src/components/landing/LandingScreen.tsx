import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { FoxMascot } from './FoxMascot';
import { MenuOverlay, type LandingCta, type LandingNavItem } from './MenuOverlay';

/** Landing nav — the real console routes, styled as marketing pills. */
export const LANDING_NAV: LandingNavItem[] = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Incidents', to: '/incidents' },
  { label: 'Connect', to: '/onboarding' },
  { label: 'Demo', to: '/demo' },
];

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260713_234424_b1332b69-2e69-4302-8dbc-40f86846afbd.mp4';

/**
 * Full-screen animated brand screen shared by the home page and the 404 page.
 * Orange gradient, a giant stretched background word behind a white oval, a
 * looping character video blended into the gradient, pill nav on top and a
 * heading + CTA pinned to the bottom. Single viewport height, no scrolling.
 * Brand-fixed colors (identical in light/dark), hence the raw hexes.
 */
export function LandingScreen({
  giantText,
  heading,
  cta,
  mascot = 'video',
}: {
  giantText: string;
  heading: string;
  cta: LandingCta;
  /** 'fox' = rigged SVG fox (eyes track the cursor, waves on click); 'video' = the pre-rendered clip. */
  mascot?: 'video' | 'fox';
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scaleY, setScaleY] = useState(1);
  const [booping, setBooping] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const charBoxRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useRef(false);

  useEffect(() => {
    reduceMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Clear the boop on a timer rather than animationend: the event never fires
  // if the tab is hidden mid-animation, which would leave the fox un-boopable.
  useEffect(() => {
    if (!booping) return;
    const t = window.setTimeout(() => setBooping(false), 700);
    return () => window.clearTimeout(t);
  }, [booping]);

  // Playful parallax: the character drifts toward the cursor, the giant word
  // drifts away, giving the flat video a sense of depth. Refs (not state) so
  // mousemove doesn't re-render; disabled for reduced-motion users.
  const onMouseMove = (e: React.MouseEvent): void => {
    if (reduceMotion.current) return;
    const nx = (e.clientX / window.innerWidth - 0.5) * 2;
    const ny = (e.clientY / window.innerHeight - 0.5) * 2;
    if (charBoxRef.current) {
      charBoxRef.current.style.transform = `translate(${nx * 16}px, ${ny * 12}px) rotate(${nx * 1.5}deg)`;
    }
    if (bgRef.current) {
      bgRef.current.style.transform = `translate(${nx * -10}px, ${ny * -6}px)`;
    }
  };

  const onMouseLeave = (): void => {
    if (charBoxRef.current) charBoxRef.current.style.transform = '';
    if (bgRef.current) bgRef.current.style.transform = '';
  };

  // Stretch the background word to fill the viewport height: measure the
  // rendered text, derive innerHeight / textHeight, re-measure on resize.
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = textRef.current;
      if (!el) return;
      const h = el.offsetHeight;
      if (h > 0) setScaleY(window.innerHeight / h);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const CtaIcon = cta.icon;

  return (
    <div
      className="relative flex h-screen w-full flex-col overflow-hidden"
      style={{ background: 'linear-gradient(to bottom, #FF8233, #FDAC55)' }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {/* Background layer: giant word + white oval, fading out toward the bottom */}
      <div
        ref={bgRef}
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0.85,
          maskImage: 'linear-gradient(to bottom, black 50%, transparent 96%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 96%)',
          transition: 'transform 0.3s ease-out',
          willChange: 'transform',
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={textRef}
            className="select-none whitespace-nowrap font-black leading-none tracking-tighter text-white"
            style={{
              // 44vw (not the spec's 48vw): at 48vw the 1.15x-stretched word is
              // wider than the viewport and the clip cuts the outer digits off.
              fontSize: 'clamp(200px, 44vw, 760px)',
              transform: `scale(1.15, ${scaleY * 1.4})`,
            }}
          >
            {giantText}
          </div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="h-[22vh] rounded-full bg-white sm:h-[26vh] md:h-[50vh]"
            style={{
              width: 'clamp(120px, 20vw, 400px)',
              transform: `scaleY(${scaleY})`,
              transformOrigin: 'center',
            }}
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="relative z-20 flex items-center justify-between px-4 py-4 sm:px-6 sm:py-5 md:px-12">
        <BrandMark />

        <div className="hidden gap-1 md:flex">
          {LANDING_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-full bg-white px-4 py-1.5 text-sm font-medium transition-colors hover:opacity-90"
              style={{ color: '#F16524' }}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-white transition-colors hover:opacity-90 sm:px-5 sm:py-2.5"
          style={{ backgroundColor: '#F16524' }}
        >
          <Menu className="h-4 w-4" />
          <span className="hidden text-sm font-medium sm:inline">Menu</span>
        </button>
      </nav>

      {/* Center video, blended into the gradient */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{ marginTop: 'calc(-6vh - 40px)' }}
      >
        {mascot === 'fox' ? (
          <div
            ref={(el) => {
              charBoxRef.current = el;
            }}
            className="pointer-events-none h-[85vh] w-[120vw] sm:h-[70vh] sm:w-[70vw] md:h-[78vh] md:w-[62vw]"
            style={{ transition: 'transform 0.3s ease-out', willChange: 'transform' }}
          >
            <FoxMascot />
          </div>
        ) : (
        <button
          type="button"
          ref={(el) => {
            charBoxRef.current = el;
          }}
          onClick={() => setBooping(true)}
          aria-label="Poke the fox mascot"
          className="pointer-events-auto h-[85vh] w-[120vw] cursor-pointer mix-blend-darken sm:h-[70vh] sm:w-[70vw] md:h-[78vh] md:w-[62vw]"
          style={{ transition: 'transform 0.3s ease-out', willChange: 'transform' }}
        >
          {/* The blend lives on the button, not the video: the button's transform
              creates a stacking context, and a blend inside it can't reach the
              page gradient — the video's white background would show as a box. */}
          <video
            src={VIDEO_URL}
            autoPlay
            loop
            muted
            playsInline
            className={`pointer-events-none h-full w-full object-contain ${
              booping ? 'animate-boop' : ''
            }`}
          />
        </button>
        )}
      </div>

      {/* Bottom heading + CTA */}
      <div className="relative z-30 mt-auto flex flex-col items-center px-4 pb-8 text-center sm:pb-16">
        <h1
          className="mb-3 text-lg font-medium text-white sm:mb-4 sm:text-xl md:text-2xl"
          style={{ textShadow: '0 1px 3px rgba(180, 65, 10, 0.45), 0 2px 14px rgba(180, 65, 10, 0.3)' }}
        >
          {heading}
        </h1>
        <Link
          to={cta.to}
          className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white transition-all hover:scale-105 hover:shadow-lg sm:px-8 sm:py-4 sm:text-base"
          style={{ backgroundColor: '#F16524' }}
        >
          <CtaIcon className="h-4 w-4 sm:h-5 sm:w-5" />
          {cta.label}
        </Link>
      </div>

      <MenuOverlay
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={LANDING_NAV}
        cta={cta}
      />
    </div>
  );
}
