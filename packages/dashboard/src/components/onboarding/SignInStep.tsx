import { useState } from 'react';
import { Github, ArrowRight, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import type { User } from '@oncall/shared';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { v, tint } from '../../lib/tokens';
import { githubLoginUrl } from './api';

/**
 * Step 1 — Sign in (DESIGN_SPEC §6.1). Hero + subcopy, a full-width 44px
 * "Sign in with GitHub" primary → `GET /auth/github/login`. Because the OAuth
 * creds are intentionally empty right now, that endpoint `503`s; the button
 * **probes** it and, on 503, surfaces a clear "sign-in unavailable until OAuth is
 * configured" note (the live-OAuth exercise is deferred to QA — MAPPING creds row).
 * Under `DEV_NO_AUTH` we also show a `--warn` "Dev mode — auth bypassed" note and a
 * secondary **Continue** that advances to repo selection. When creds land later the
 * same button transparently redirects to GitHub — no code change needed.
 */
export function SignInStep({
  devMode,
  user,
  onContinue,
}: {
  devMode: boolean;
  user: User | null;
  onContinue: () => void;
}) {
  const [probe, setProbe] = useState<'idle' | 'checking' | 'unavailable'>('idle');

  async function signIn(): Promise<void> {
    setProbe('checking');
    const url = githubLoginUrl();
    try {
      // `redirect: 'manual'` → a 302 to GitHub yields an opaque redirect (status 0);
      // a 503 (creds missing) comes back as a normal response we can inspect.
      const res = await fetch(url, { credentials: 'include', redirect: 'manual' });
      if (res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400)) {
        window.location.assign(url); // let the browser follow the OAuth redirect
        return;
      }
      setProbe('unavailable');
    } catch {
      setProbe('unavailable');
    }
  }

  // Already signed in via real OAuth → confirm identity + continue.
  if (user) {
    return (
      <div className="flex flex-col gap-5">
        <Header />
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <Avatar user={user} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-md font-medium text-ink">@{user.github_login}</p>
            <p className="text-sm text-ink-muted-text">Signed in with GitHub</p>
          </div>
          <span style={{ color: v('ok') }}>
            <Icon icon={CheckCircle2} size={20} />
          </span>
        </div>
        <Button
          variant="primary"
          className="h-11 w-full"
          onClick={onContinue}
          leadingIcon={<Icon icon={ArrowRight} size={16} />}
        >
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Header />

      <Button
        variant="primary"
        className="h-11 w-full"
        onClick={() => void signIn()}
        disabled={probe === 'checking'}
        aria-busy={probe === 'checking'}
        leadingIcon={
          probe === 'checking' ? (
            <Icon icon={Loader2} size={16} className="animate-spin" />
          ) : (
            <Icon icon={Github} size={16} />
          )
        }
      >
        Sign in with GitHub
      </Button>

      {probe === 'unavailable' && (
        <div
          className="flex items-start gap-2 rounded-md p-3 text-sm text-ink-2"
          style={{ backgroundColor: tint('serious', 12) }}
          role="alert"
        >
          <span className="mt-0.5 shrink-0" style={{ color: v('serious') }}>
            <Icon icon={AlertTriangle} size={16} />
          </span>
          <span>
            Sign-in is unavailable until GitHub OAuth is configured
            (<code className="rounded bg-surface-2 px-1 text-mono-sm">GITHUB_OAUTH_CLIENT_ID/SECRET</code>).
            {devMode ? ' Continue in dev mode below.' : ''}
          </span>
        </div>
      )}

      {devMode && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-2"
            style={{ backgroundColor: tint('warn', 12) }}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: v('warn') }} />
            Dev mode — auth bypassed (<code className="text-mono-sm">DEV_NO_AUTH</code>)
          </div>
          <Button
            variant="secondary"
            className="h-11 w-full"
            onClick={onContinue}
            leadingIcon={<Icon icon={ArrowRight} size={16} />}
          >
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-hero font-semibold text-ink">
        Connect your service in under 5 minutes
      </h1>
      <p className="text-body text-ink-2">
        OnCall AI watches your logs, detects incidents, and opens fix PRs on your
        behalf. Sign in with GitHub to authorize the repo it can propose pull
        requests against.
      </p>
    </div>
  );
}

/** Avatar with an initial-letter fallback if the remote image fails (DESIGN_SPEC §14). */
function Avatar({ user }: { user: User }) {
  const [failed, setFailed] = useState(false);
  const initial = user.github_login.slice(0, 1).toUpperCase();

  if (!user.avatar_url || failed) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-surface-3 text-sm font-medium text-ink-2">
        {initial}
      </span>
    );
  }
  return (
    <img
      src={user.avatar_url}
      alt=""
      width={32}
      height={32}
      onError={() => setFailed(true)}
      className="h-8 w-8 shrink-0 rounded-pill"
    />
  );
}
