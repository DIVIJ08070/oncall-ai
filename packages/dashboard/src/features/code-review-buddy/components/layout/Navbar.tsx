import { Link } from 'react-router-dom';
import { LogoDiamond } from '../../../../components/shell/UnifiedChrome';

interface NavbarProps {
  variant?: 'landing' | 'app';
}

const LANDING_LINKS: { label: string; href: string }[] = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how' },
  { label: 'Demo', href: '#demo' },
  { label: 'Contact', href: '#contact' },
];

export function Navbar({ variant = 'landing' }: NavbarProps) {
  return (
    <header
      className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#050505]/80 backdrop-blur-md"
      style={{ fontFamily: "'Kanit', sans-serif" }}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-5">
          <Link to="/" className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-white">
            <LogoDiamond size={16} />
            <span className="hidden sm:block">OnCall AI</span>
          </Link>
          <span aria-hidden className="h-4 w-px bg-white/15" />
          <Link to="/code-review" className="text-[15px] font-bold tracking-tight text-white">
            Code Review Buddy
          </Link>
        </div>

        {variant === 'landing' ? (
          <div className="flex items-center gap-6">
            {LANDING_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="hidden rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white md:block"
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/code-review/app"
              className="inline-flex items-center justify-center rounded-lg bg-[#F16524] px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#FF8233] active:scale-[0.98]"
            >
              Open App
            </Link>
          </div>
        ) : (
          <Link
            to="/code-review"
            className="text-sm text-white/70 transition-colors hover:text-white"
          >
            Landing
          </Link>
        )}
      </nav>
    </header>
  );
}
