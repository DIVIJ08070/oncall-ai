import { Activity, Github } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Icon } from '../primitives/Icon';
import { ConnectionStatus } from '../primitives/ConnectionStatus';
import { Chip } from '../primitives/Badge';
import { useLiveAggregate } from '../../state/LiveContext';
import { useSession } from '../../state/SessionContext';

/**
 * TopBar (DESIGN_SPEC §4): sticky 56px, `--surface` + bottom border + `--elev-1`.
 * Left = product mark + wordmark; center (≥1024) = global ConnectionStatus;
 * right = DEV badge / user avatar / Sign in.
 */
export function TopBar() {
  const aggregate = useLiveAggregate();
  const { user, devMode } = useSession();

  return (
    <header className="sticky top-0 z-header flex h-14 items-center justify-between border-b border-border bg-surface px-4 shadow-elev-1 md:px-6">
      <Link to="/" className="flex items-center gap-2 rounded-md">
        <span className="text-accent">
          <Icon icon={Activity} size={20} />
        </span>
        <span className="text-h3 font-semibold text-ink">OnCall AI</span>
      </Link>

      <div className="hidden lg:flex">
        <ConnectionStatus status={aggregate} />
      </div>

      <div className="flex items-center gap-2">
        {devMode && (
          <span
            className="inline-flex h-6 items-center rounded-pill px-2 text-label uppercase text-ink"
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
            className="inline-flex h-8 items-center rounded-md border border-border-strong px-3 text-body-md font-medium text-ink hover:bg-surface-3"
          >
            Sign in
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
        className="h-6 w-6 rounded-full border border-border object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-3 text-sm font-medium text-ink-2">
      {initial}
    </span>
  );
}
