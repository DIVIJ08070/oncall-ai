import { Link } from 'react-router-dom';

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
      className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#0C0C0C]/70 backdrop-blur-md"
      style={{ fontFamily: "'Kanit', sans-serif" }}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="hidden text-sm text-white/50 transition-colors hover:text-white sm:block"
          >
            &larr; OnCall AI
          </Link>
          <Link to="/code-review" className="text-lg font-bold text-white">
            Code Review Buddy
          </Link>
        </div>

        {variant === 'landing' ? (
          <div className="flex items-center gap-6">
            {LANDING_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="hidden text-sm text-white/70 transition-colors hover:text-white md:block"
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/code-review/app"
              className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition-all duration-200 hover:scale-[1.03] hover:bg-white/90 active:scale-[0.98]"
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
