import { useMemo, useState } from 'react';
import {
  Github,
  Search,
  Lock,
  GitBranch,
  Loader2,
  ExternalLink,
  ArrowLeft,
} from 'lucide-react';
import type { RepoRef } from '@oncall/shared';
import { ApiRequestError } from '../../api/client';
import { usePolling } from '../../hooks/usePolling';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Chip } from '../primitives/Badge';
import { Skeleton } from '../primitives/Skeleton';
import { EmptyState } from '../primitives/EmptyState';
import { v } from '../../lib/tokens';
import { getRepos, selectRepo, githubLoginUrl } from './api';

/**
 * Step 2 — Select repository (DESIGN_SPEC §6.1). Lists `GET /repos` (the platform
 * PAT backs the list under `DEV_NO_AUTH`), client-side search filter, scrollable
 * list (max-height 320, internal scroll). Choosing a row `POST /repos/select`;
 * a `422` (missing Contents/PR write) renders the inline `--critical` re-authorize
 * message on that row. Loading = 5 skeleton rows; empty = "No repositories found".
 */
export function RepoPicker({
  onSelected,
  onBack,
}: {
  onSelected: (repo: RepoRef) => void;
  onBack: () => void;
}) {
  const { data, loading, error, refetch } = usePolling((signal) => getRepos(signal), []);
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState<string | null>(null);
  const [permDenied, setPermDenied] = useState<string | null>(null);
  const [failMsg, setFailMsg] = useState<string | null>(null);

  const repos = data?.repos ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => `${r.owner}/${r.repo}`.toLowerCase().includes(q));
  }, [repos, query]);

  async function choose(repo: RepoRef): Promise<void> {
    const key = `${repo.owner}/${repo.repo}`;
    setSelecting(key);
    setPermDenied(null);
    setFailMsg(null);
    try {
      await selectRepo({ owner: repo.owner, repo: repo.repo });
      onSelected(repo);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 422) {
        setPermDenied(key);
      } else {
        setFailMsg(err instanceof Error ? err.message : 'Failed to select repo');
      }
      setSelecting(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 font-semibold text-ink">
          Choose the repo OnCall AI can open PRs against
        </h2>
        <p className="text-sm text-ink-2">
          Fixes are proposed as pull requests on this repository — never merged
          automatically.
        </p>
      </div>

      {/* Search */}
      <label className="relative block">
        <span className="sr-only">Filter repositories</span>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted-text">
          <Icon icon={Search} size={16} />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter repositories…"
          className="h-9 w-full rounded-md border border-border-strong bg-surface-2 pl-9 pr-3 text-body text-ink placeholder:text-ink-muted-text focus:border-accent"
        />
      </label>

      {/* List */}
      {loading ? (
        <ul className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-center gap-3 rounded-md border border-border p-3">
              <Skeleton className="h-4 w-4" rounded="rounded-pill" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-5 w-16" rounded="rounded-pill" />
            </li>
          ))}
        </ul>
      ) : error ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-3 text-sm text-ink-2">
          <span>Couldn&apos;t load repositories — {error.message}</span>
          <Button variant="ghost" onClick={refetch}>
            Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-surface-2">
          <EmptyState
            icon={Github}
            title={query ? 'No matching repositories' : 'No repositories found'}
            subtitle={
              query
                ? 'Try a different search term.'
                : 'The signed-in token can’t see any repositories to authorize.'
            }
          />
        </div>
      ) : (
        <ul
          className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-0.5"
          role="radiogroup"
          aria-label="Repositories"
        >
          {filtered.map((repo) => {
            const key = `${repo.owner}/${repo.repo}`;
            const busy = selecting === key;
            const denied = permDenied === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={false}
                  disabled={selecting !== null}
                  onClick={() => void choose(repo)}
                  className={`flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors duration-fast hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-70 ${
                    denied ? 'border-critical' : 'border-border'
                  }`}
                >
                  <span className="shrink-0 text-ink-muted-text">
                    <Icon icon={Github} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-md font-medium text-ink">
                      {repo.owner}/{repo.repo}
                    </span>
                  </span>
                  <Chip className="shrink-0 gap-1">
                    <Icon icon={GitBranch} size={12} />
                    {repo.default_branch}
                  </Chip>
                  {repo.private && (
                    <Chip className="shrink-0 gap-1" title="Private repository">
                      <Icon icon={Lock} size={12} />
                      Private
                    </Chip>
                  )}
                  {/* Right-side radio dot */}
                  <span
                    aria-hidden="true"
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border border-border-strong"
                  >
                    {busy ? (
                      <Icon icon={Loader2} size={12} className="animate-spin text-accent" />
                    ) : null}
                  </span>
                </button>

                {denied && (
                  <div
                    className="mt-1 flex flex-col gap-1 rounded-md px-3 py-2 text-sm"
                    style={{ color: v('critical') }}
                  >
                    <span>Missing Contents/PR permission — re-authorize this repo on GitHub.</span>
                    <a
                      href={githubLoginUrl()}
                      className="inline-flex w-fit items-center gap-1 font-medium text-accent-text hover:underline"
                    >
                      Re-authorize
                      <Icon icon={ExternalLink} size={13} />
                    </a>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {failMsg && (
        <p className="text-sm" style={{ color: v('critical') }} role="alert">
          {failMsg}
        </p>
      )}

      <div className="flex items-center justify-between pt-1">
        <Button
          variant="ghost"
          onClick={onBack}
          leadingIcon={<Icon icon={ArrowLeft} size={16} />}
        >
          Back
        </Button>
      </div>
    </div>
  );
}
