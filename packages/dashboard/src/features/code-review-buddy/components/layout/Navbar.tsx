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
      className="fixed inset-x-0 top-0 z-50 border-b border-border backdrop-blur-md"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--bg) 78%, transparent)',
      }}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="hidden text-sm text-ink-muted-text transition-colors hover:text-ink sm:block"
          >
            &larr; OnCall AI
          </Link>
          <Link
            to="/code-review"
            className="crt-glow text-sm font-bold uppercase tracking-[0.14em] text-ink"
          >
            <span aria-hidden className="text-accent">
              &gt;{' '}
            </span>
            Code Review Buddy
          </Link>
        </div>

        {variant === 'landing' ? (
          <div className="flex items-center gap-6">
            {LANDING_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="hidden text-sm uppercase tracking-[0.08em] text-ink-2 transition-colors hover:text-ink md:block"
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/code-review/app"
              className="inline-flex items-center justify-center rounded-sm bg-primary px-5 py-2 text-sm font-bold uppercase tracking-[0.1em] text-black transition-all duration-200 hover:scale-[1.03] hover:bg-primary-hover active:scale-[0.98]"
            >
              [ Open App ]
            </Link>
          </div>
        ) : (
          <Link
            to="/code-review"
            className="text-sm uppercase tracking-[0.08em] text-ink-2 transition-colors hover:text-ink"
          >
            Landing
          </Link>
        )}
      </nav>
    </header>
  );
}
