import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../primitives/Icon';
import { NAV_ITEMS } from './navItems';

/**
 * Mobile bottom tab bar (DESIGN_SPEC §4, <640): 56px, thumb-reachable, 4 icons +
 * labels, `--surface` + top border, z 100. Active tab = `--accent` icon +
 * `--accent-text` label.
 */
export function BottomTabBar() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-header flex h-14 items-stretch border-t border-border bg-surface sm:hidden">
      {NAV_ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 ${
              active ? 'text-accent' : 'text-ink-2'
            }`}
          >
            <Icon icon={item.icon} size={20} />
            <span className={`text-label ${active ? 'text-accent-text' : 'text-ink-muted-text'}`}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
