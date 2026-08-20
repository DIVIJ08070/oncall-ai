import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, ErrorMessage, Spinner } from '../../../components/ui';
import { MonoTag } from '../../../../../components/atmosphere';
import type { WatchedRepo } from '../../../lib/types';
import { useWatchStore } from '../../../store/watchStore';
import { AutoReviewCard } from './AutoReviewCard';
import { timeAgo } from './time';

const GITHUB_REPO_PATTERN = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/;

/** Register form: repo URL input + Watch repo button. */
function WatchForm() {
  const [repoUrl, setRepoUrl] = useState('');
  const loading = useWatchStore((s) => s.loading);
  const add = useWatchStore((s) => s.add);

  const trimmed = repoUrl.trim();
  const valid = GITHUB_REPO_PATTERN.test(trimmed);
  const showHint = trimmed.length > 0 && !valid;
  const disabled = !valid || loading;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled) return;
    setRepoUrl('');
    void add(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="url"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          spellCheck={false}
          className="w-full flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/30"
        />
        <Button type="submit" disabled={disabled}>
          {loading && <Spinner size={16} />}
          {loading ? 'Watching…' : 'Watch repo'}
        </Button>
      </div>

      {showHint && (
        <p className="text-xs text-yellow-400/80">
          Enter a GitHub repository URL like https://github.com/owner/repo
        </p>
      )}
    </form>
  );
}

/** One watched repo: owner/repo, when added, rule count, unwatch button. */
function WatchRow({ watch }: { watch: WatchedRepo }) {
  const remove = useWatchStore((s) => s.remove);
  const loading = useWatchStore((s) => s.loading);

  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="min-w-0 flex-1">
        <a
          href={watch.repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate font-mono text-sm text-white/85 transition-colors hover:text-white"
        >
          {watch.owner}/{watch.repo}
        </a>
        <p className="mt-0.5 text-xs text-white/40">
          added {timeAgo(watch.createdAt)} ·{' '}
          {watch.rules.length === 1 ? '1 custom rule' : `${watch.rules.length} custom rules`}
        </p>
      </div>

      <button
        type="button"
        aria-label={`Stop watching ${watch.owner}/${watch.repo}`}
        disabled={loading}
        onClick={() => void remove(watch.id)}
        className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 size={16} />
      </button>
    </li>
  );
}

/**
 * PR Watch panel — register repos, see what's watched, and read the feed of
 * automatic PR reviews. Polls the server every 20s while mounted (the panel
 * stays mounted behind the tab bar, which keeps the tab's count fresh too).
 */
export function WatchManager() {
  const watches = useWatchStore((s) => s.watches);
  const reviews = useWatchStore((s) => s.reviews);
  const loaded = useWatchStore((s) => s.loaded);
  const error = useWatchStore((s) => s.error);

  useEffect(() => {
    void useWatchStore.getState().refresh();
    const timer = setInterval(() => {
      void useWatchStore.getState().refresh();
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-8">
      <WatchForm />

      {error && <ErrorMessage message={error} />}

      {!loaded ? (
        <div className="flex items-center gap-3 py-8 text-white/60">
          <Spinner />
          <span className="text-sm">Loading watched repos…</span>
        </div>
      ) : watches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center">
          <p className="text-white/70">No repos watched yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
            Register a repo — every new pull request gets an automatic AI
            review, posted right on the PR.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <MonoTag>WATCH / REPOS ({watches.length})</MonoTag>
          <ul className="space-y-3">
            {watches.map((watch) => (
              <WatchRow key={watch.id} watch={watch} />
            ))}
          </ul>
        </div>
      )}

      {loaded && (
        <div className="space-y-3">
          <MonoTag>WATCH / AUTO-REVIEWS ({reviews.length})</MonoTag>
          {reviews.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center">
              <p className="text-white/70">No auto-reviews yet.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
                {watches.length === 0
                  ? 'Watch a repo above and its open pull requests will start showing up here, each with a full AI review.'
                  : 'Open pull requests are picked up automatically — new reviews appear here (and on the PR) within a minute or two.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map((review) => (
                <AutoReviewCard key={review.id} review={review} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
