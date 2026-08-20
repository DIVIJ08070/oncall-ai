import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Spinner } from '../../../components/ui';
import { useRepoReviewStore } from '../../../store/repoReviewStore';
import { useRulesStore } from '../../../store/rulesStore';

const GITHUB_REPO_PATTERN = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/;

export function RepoUrlInput() {
  const [repoUrl, setRepoUrl] = useState('');
  const loading = useRepoReviewStore((s) => s.loading);
  const runRepoReview = useRepoReviewStore((s) => s.runRepoReview);
  const rules = useRulesStore((s) => s.rules);

  const trimmed = repoUrl.trim();
  const valid = GITHUB_REPO_PATTERN.test(trimmed);
  const showHint = trimmed.length > 0 && !valid;
  const disabled = !valid || loading;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled) return;
    void runRepoReview({
      repoUrl: trimmed,
      customRules: rules.filter((r) => r.enabled),
    });
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
          {loading ? 'Scanning…' : 'Review Repo'}
        </Button>
      </div>

      {showHint && (
        <p className="text-xs text-yellow-400/80">
          Enter a public GitHub repository URL like https://github.com/owner/repo
        </p>
      )}

      {loading && (
        <p className="text-sm text-white/50">
          Scanning up to 15 source files — this can take a minute.
        </p>
      )}
    </form>
  );
}
