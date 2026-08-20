import { Github } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Icon } from '../primitives/Icon';
import { ConnectionStatus } from '../primitives/ConnectionStatus';
import { Chip } from '../primitives/Badge';
import { MonoTag } from '../atmosphere';
import { useLiveAggregate } from '../../state/LiveContext';
import { useSession } from '../../state/SessionContext';

/**
 * TopBar (DESIGN_SPEC §4): sticky 56px terminal titlebar — `--surface` +
 * hairline bottom border + faint CRT flicker.
 * Left = diamond mark + "ONCALL.AI" mono wordmark + TTY1 tag;
 * center (≥1024) = global ConnectionStatus; right = DEV badge / avatar / sign-in.
 */
export function TopBar() {
  const aggregate = useLiveAggregate();
  const { user, devMode } = useSession();

  return (
    <header
      className="crt-flicker sticky top-0 z-header flex h-14 items-center justify-between border-b border-border px-4 shadow-elev-1 backdrop-blur-md md:px-6"
      style={{ backgroundColor: 'color-mix(in srgb, var(--surface) 78%, transparent)' }}
    >
      <Link to="/dashboard" className="flex items-center gap-2.5 rounded-none">
        {/* Diamond mark carried over from the landing hero; wordmark is now a
            phosphor terminal title so the console reads as the machine itself. */}
        <svg
          width={22}
          height={22}
          viewBox="0 0 256 256"
          className="text-accent"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M 256 256 L 128 256 L 0 128 L 128 128 Z M 256 128 L 128 128 L 0 0 L 128 0 Z" />
        </svg>
        <span className="crt-glow text-sm font-bold uppercase tracking-[0.22em] text-ink">
          ONCALL.AI
        </span>
        <MonoTag className="hidden sm:inline-flex">TTY1</MonoTag>
      </Link>

      <div className="hidden lg:flex">
        <ConnectionStatus status={aggregate} />
      </div>

      <div className="flex items-center gap-2">
        {devMode && (
          <span
            className="inline-flex h-6 items-center rounded-sm px-2 text-label uppercase tracking-wider text-ink"
            style={{ backgroundColor: 'color-mix(in srgb, var(--warn) 18%, transparent)' }}
            title="DEV_NO_AUTH — read APIs open without a session"
          >
            Dev
          </span>
        )}

        {user ? (
          <>
            <Chip className="hidden sm:inline-flex" title="Signed in with GitHub">
              <Icon icon={Github} size={13} className="mr-1" />
              {user.github_login}
            </Chip>
            <Avatar user={user} />
          </>
        ) : (
          <Link
            to="/onboarding"
            className="inline-flex h-8 items-center rounded-none border border-border-strong px-3 text-label font-medium uppercase tracking-wider text-ink hover:bg-surface-3"
          >
            {'> '}Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

/** 24px avatar from `auth/me`, with an initial-letter fallback (DESIGN_SPEC §14). */
function Avatar({ user }: { user: { github_login: string; avatar_url: string | null } }) {
  const initial = user.github_login.charAt(0).toUpperCase();
  if (user.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user.github_login}
        width={24}
        height={24}
        className="h-6 w-6 rounded-sm border border-border object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-surface-3 text-sm font-medium text-ink-2">
      {initial}
    </span>
  );
}
