import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Menu } from 'lucide-react';
import { MenuOverlay, type LandingNavItem } from './MenuOverlay';
import { TargetCursor } from '../primitives/TargetCursor';

/**
 * Public home hero for OnCall AI — a dark, full-screen scene with a
 * cursor-following spotlight that reveals a second image through a soft circular
 * mask (adapted from the "Lithos" spec). The reveal metaphor fits the product:
 * move the light over the surface to see what's underneath an incident.
 *
 * The two images below are placeholders (swap the URLs for on-brand art — e.g. a
 * calm system state on top, the incident "x-ray" underneath). The reveal
 * mechanic, layout, and load animations follow the spec.
 */
const BG_IMAGE_1 =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260609_195923_b0ba8ace-1d1d-4f2c-9a28-1ab84b330680.png&w=1280&q=85';
const BG_IMAGE_2 =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260609_201152_bba90a12-bf12-459f-91f0-51f237dbaf3b.png&w=1280&q=85';

const SPOTLIGHT_R = 260;

/** Center nav pill + mobile menu share these routes (the real console pages). */
const NAV: (LandingNavItem & { active?: boolean })[] = [
  { label: 'Home', to: '/', active: true },
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Incidents', to: '/incidents' },
  { label: 'Connect', to: '/onboarding' },
  { label: 'Live Demo', to: '/demo' },
];

export function SpotlightHero() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="min-h-screen bg-white tracking-[-0.02em]"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Crosshair pointer — brand surfaces only; the console keeps the real cursor. */}
      <TargetCursor spinDuration={2} hoverDuration={0.2} cursorColorOnTarget="#F16524" />

      <Nav onOpenMenu={() => setMenuOpen(true)} />

      <section
        className="relative h-screen w-full overflow-hidden bg-black"
        style={{ height: '100dvh' }}
      >
        {/* 1 — base image (slow Ken Burns zoom-out) */}
        <div
          className="hero-zoom absolute inset-0 z-10 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${BG_IMAGE_1})` }}
        />

        {/* 2 — cursor-revealed second image (self-contained: tracks the mouse and
               paints its own mask, so it can't stall on React re-render timing) */}
        <RevealLayer image={BG_IMAGE_2} />

        {/* 3 — heading */}
        <div className="pointer-events-none absolute left-0 right-0 top-[14%] z-50 flex flex-col items-center px-5 text-center">
          <h1 className="leading-[0.95] text-white">
            <span
              className="hero-anim hero-reveal block font-playfair text-5xl font-normal italic sm:text-7xl md:text-8xl"
              style={{ letterSpacing: '-0.05em', animationDelay: '0.25s' }}
            >
              Incidents happen.
            </span>
            <span
              className="hero-anim hero-reveal -mt-1 block text-5xl font-normal sm:text-7xl md:text-8xl"
              style={{ letterSpacing: '-0.08em', animationDelay: '0.42s' }}
            >
              We're already on it.
            </span>
          </h1>
        </div>

        {/* 4 — bottom-left paragraph */}
        <div
          className="hero-anim hero-fade absolute bottom-14 left-10 z-50 hidden max-w-[260px] sm:block md:left-14"
          style={{ animationDelay: '0.7s' }}
        >
          <p className="text-sm leading-relaxed text-white/80">
            Every log line records a moment in your system's story — from the first slow query to
            the cascade that woke the pager, captured the instant it happens.
          </p>
        </div>

        {/* 5 — bottom-right block */}
        <div
          className="hero-anim hero-fade absolute bottom-10 left-5 right-5 z-50 flex max-w-full flex-col items-start gap-4 sm:bottom-24 sm:left-auto sm:right-10 sm:max-w-[260px] sm:gap-5 md:right-14"
          style={{ animationDelay: '0.85s' }}
        >
          <p className="text-xs leading-relaxed text-white/80 sm:text-sm">
            OnCall AI peels back the stack to trace how errors, deploys, and dependencies combine to
            break the thing your users touch — then drafts the fix.
          </p>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="cursor-target rounded-full bg-[#F16524] px-7 py-3 text-sm font-medium text-white shadow-lg shadow-[#F16524]/30 transition-all hover:scale-[1.03] hover:bg-[#d9531a] hover:shadow-lg active:scale-95"
          >
            Open Dashboard
          </button>
        </div>
      </section>

      <MenuOverlay
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={NAV}
        cta={{ label: 'Sign Up', to: '/onboarding', icon: ArrowRight }}
      />
    </div>
  );
}

/**
 * Reveal layer. A hidden canvas paints a soft radial mask that trails the cursor
 * (eased), and that mask is applied to the reveal image so it shows only inside
 * the glowing circle. Everything runs imperatively in one rAF loop with no React
 * state, so it never depends on re-render timing.
 */
function RevealLayer({ image }: { image: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const reveal = revealRef.current;
    if (!canvas || !reveal) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sizeCanvas = (): void => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    sizeCanvas();

    // Raw pointer + eased position. Start off-screen so the reveal is hidden
    // until the cursor enters.
    const mouse = { x: -9999, y: -9999 };
    const smooth = { x: -9999, y: -9999 };

    const onMove = (e: MouseEvent): void => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('resize', sizeCanvas);

    let raf = 0;
    const draw = (): void => {
      smooth.x += (mouse.x - smooth.x) * 0.1;
      smooth.y += (mouse.y - smooth.y) * 0.1;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const g = ctx.createRadialGradient(smooth.x, smooth.y, 0, smooth.x, smooth.y, SPOTLIGHT_R);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,255,255,1)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.75, 'rgba(255,255,255,0.4)');
      g.addColorStop(0.88, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(smooth.x, smooth.y, SPOTLIGHT_R, 0, Math.PI * 2);
      ctx.fill();

      const url = canvas.toDataURL();
      reveal.style.webkitMaskImage = `url(${url})`;
      reveal.style.maskImage = `url(${url})`;
      reveal.style.webkitMaskSize = '100% 100%';
      reveal.style.maskSize = '100% 100%';

      raf = requestAnimationFrame(draw);
    };
    // Paint one frame immediately (transparent mask → reveal hidden), then loop.
    draw();

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', sizeCanvas);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0"
        style={{ display: 'none' }}
      />
      <div
        ref={revealRef}
        className="pointer-events-none absolute inset-0 z-30 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${image})`,
          // The two source images differ only slightly, so warm the revealed
          // layer hard: the spotlight then clearly "lights up" the lava under it.
          filter: 'brightness(1.7) saturate(1.9) contrast(1.15)',
        }}
      />
    </>
  );
}

function Nav({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <nav className="fixed left-0 right-0 top-0 z-[100] flex items-center justify-between p-4 sm:p-5">
      <Link to="/" className="cursor-target flex items-center gap-2">
        <svg width={26} height={26} viewBox="0 0 256 256" fill="#ffffff" aria-hidden="true">
          <path d="M 256 256 L 128 256 L 0 128 L 128 128 Z M 256 128 L 128 128 L 0 0 L 128 0 Z" />
        </svg>
        <span className="font-playfair text-2xl italic text-white">OnCall AI</span>
      </Link>

      <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-white/30 bg-white/20 px-2 py-2 backdrop-blur-md md:flex">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`cursor-target rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              item.active ? 'text-white' : 'text-white/80 hover:bg-white/20 hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <Link
        to="/onboarding"
        className="cursor-target hidden rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-100 md:block"
      >
        Sign Up
      </Link>

      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="cursor-target flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/20 text-white backdrop-blur-md md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
    </nav>
  );
}
