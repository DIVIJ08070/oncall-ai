import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BrandMark } from './BrandMark';

export interface LandingNavItem {
  label: string;
  to: string;
}

export interface LandingCta {
  label: string;
  to: string;
  icon: LucideIcon;
}

/**
 * Full-screen slide-in menu for the landing surfaces. Backdrop fades, the panel
 * slides from the right, items stagger in, and the bottom CTA fades last. Body
 * scroll is locked while open. Brand-fixed orange (no theme tokens on purpose).
 */
export function MenuOverlay({
  open,
  onClose,
  items,
  cta,
}: {
  open: boolean;
  onClose: () => void;
  items: LandingNavItem[];
  cta: LandingCta;
}) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const CtaIcon = cta.icon;

  return (
    <div
      className={`fixed inset-0 z-50 transition-[visibility] duration-500 ${
        open ? 'visible' : 'invisible'
      }`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-500 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      <div
        className={`absolute right-0 top-0 h-full w-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] sm:w-[380px] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ background: 'linear-gradient(135deg, #FF6B1A 0%, #FF9642 100%)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div className="flex items-center justify-between px-6 py-5">
          <BrandMark />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-col gap-2 px-6 pt-4">
          {items.map((item, i) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={`rounded-2xl bg-white/10 px-6 py-4 text-lg font-semibold text-white transition-all duration-300 hover:bg-white/20 ${
                open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
              }`}
              style={{ transitionDelay: open ? `${150 + i * 60}ms` : '0ms' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div
          className={`absolute bottom-0 left-0 right-0 p-6 transition-opacity duration-300 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transitionDelay: open ? '450ms' : '0ms' }}
        >
          <Link
            to={cta.to}
            onClick={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-4 text-base font-semibold transition-transform hover:scale-[1.02]"
            style={{ color: '#F16524' }}
          >
            <CtaIcon className="h-4 w-4" />
            {cta.label}
          </Link>
        </div>
      </div>
    </div>
  );
}
