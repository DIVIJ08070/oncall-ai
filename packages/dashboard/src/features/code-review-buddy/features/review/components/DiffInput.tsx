import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Spinner } from '../../../components/ui';
import { useReviewStore } from '../../../store/reviewStore';
import { useRulesStore } from '../../../store/rulesStore';

const CHAR_LIMIT = 100_000;

export function DiffInput() {
  const [prTitle, setPrTitle] = useState('');
  const [diff, setDiff] = useState('');
  const loading = useReviewStore((s) => s.loading);
  const runReview = useReviewStore((s) => s.runReview);
  const rules = useRulesStore((s) => s.rules);

  const overLimit = diff.length > CHAR_LIMIT;
  const disabled = diff.trim().length === 0 || loading || overLimit;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled) return;
    void runReview({
      diff,
      prTitle: prTitle.trim() ? prTitle.trim() : undefined,
      customRules: rules.filter((r) => r.enabled),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="text"
        value={prTitle}
        onChange={(e) => setPrTitle(e.target.value)}
        placeholder="PR title (optional)"
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/30"
      />

      <div>
        <textarea
          value={diff}
          onChange={(e) => setDiff(e.target.value)}
          placeholder="Paste your diff or code…"
          rows={14}
          spellCheck={false}
          className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/30"
        />
        <p
          className={`mt-1 text-right text-xs ${overLimit ? 'text-red-400' : 'text-white/40'}`}
        >
          {diff.length.toLocaleString()} / {CHAR_LIMIT.toLocaleString()} characters
        </p>
      </div>

      <Button type="submit" disabled={disabled}>
        {loading && <Spinner size={16} />}
        {loading ? 'Reviewing…' : 'Review Code'}
      </Button>
    </form>
  );
}
