import { Link, useLocation } from 'react-router-dom';
import { Moon, Sun, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Icon } from '../primitives/Icon';
import { NAV_ITEMS } from './navItems';
import { getTheme, toggleTheme, type Theme } from '../../lib/theme';
import { apiFetch } from '../../api/client';

/**
 * SideNav (DESIGN_SPEC §4). Desktop ≥1024 = 220px labelled rail; tablet 640–1023 =
 * 64px icon rail (label in `title` tooltip); hidden <640 (bottom tab bar instead).
 * Active row = `--surface-3` fill + 2px left `--accent` bar + `--ink` text.
 * Footer = theme toggle + logout.
 */
export function SideNav() {
  const { pathname } = useLocation();

  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-56px)] shrink-0 flex-col border-r border-border bg-surface sm:flex sm:w-16 lg:w-[220px]">
      <nav className="flex flex-1 flex-col gap-1 p-2 lg:p-3">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              title={item.label}
              aria-current={active ? 'page' : undefined}
              className={`relative flex h-10 items-center gap-3 rounded-lg px-2 lg:px-3 text-body-md font-medium transition-colors duration-fast ${
                active
                  ? 'bg-surface-3 text-ink'
                  : 'text-ink-2 hover:bg-surface-3 hover:text-ink'
              } justify-center lg:justify-start`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-r bg-accent" style={{ width: 2 }} />
              )}
              <Icon icon={item.icon} size={20} />
              <span className="hidden lg:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 border-t border-border p-2 lg:p-3">
        <ThemeToggle />
        <LogoutButton />
      </div>
    </aside>
  );
}

function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const onToggle = (): void => setThemeState(toggleTheme());
  return (
    <button
      type="button"
      onClick={onToggle}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle color theme"
      className="flex h-10 items-center gap-3 rounded-lg px-2 lg:px-3 text-body-md font-medium text-ink-2 transition-colors duration-fast hover:bg-surface-3 hover:text-ink justify-center lg:justify-start"
    >
      <Icon icon={theme === 'dark' ? Sun : Moon} size={20} />
      <span className="hidden lg:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}

function LogoutButton() {
  const onLogout = async (): Promise<void> => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      /* logout is best-effort in the demo */
    }
    window.location.assign('/onboarding');
  };
  return (
    <button
      type="button"
      onClick={() => void onLogout()}
      title="Log out"
      aria-label="Log out"
      className="flex h-10 items-center gap-3 rounded-lg px-2 lg:px-3 text-body-md font-medium text-ink-2 transition-colors duration-fast hover:bg-surface-3 hover:text-ink justify-center lg:justify-start"
    >
      <Icon icon={LogOut} size={20} />
      <span className="hidden lg:inline">Log out</span>
    </button>
  );
}
