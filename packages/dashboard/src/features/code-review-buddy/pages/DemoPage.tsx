import { useState } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Button, ErrorMessage, GlowBackground, Spinner } from '../components/ui';
import { DiffInput } from '../features/review/components/DiffInput';
import { ReviewResult } from '../features/review/components/ReviewResult';
import { FileReviewList } from '../features/repo-review/components/FileReviewList';
import { RepoScoreSummary } from '../features/repo-review/components/RepoScoreSummary';
import { RepoUrlInput } from '../features/repo-review/components/RepoUrlInput';
import { RulesManager } from '../features/rules/components/RulesManager';
import { useRepoReviewStore } from '../store/repoReviewStore';
import { useReviewStore } from '../store/reviewStore';
import { useRulesStore } from '../store/rulesStore';

type TabId = 'diff' | 'repo' | 'rules';

function LoadingRow() {
  return (
    <div className="flex items-center gap-3 py-8 text-white/60">
      <Spinner />
      <span className="text-sm">Analyzing…</span>
    </div>
  );
}

export function DemoPage() {
  const [tab, setTab] = useState<TabId>('diff');

  const review = useReviewStore();
  const repoReview = useRepoReviewStore();
  const rulesCount = useRulesStore((s) => s.rules.length);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'diff', label: 'Paste Diff' },
    { id: 'repo', label: 'GitHub Repo' },
    { id: 'rules', label: `Custom Rules (${rulesCount})` },
  ];

  const clearAction =
    tab === 'diff' && review.data
      ? review.reset
      : tab === 'repo' && repoReview.data
        ? repoReview.reset
        : null;

  return (
    <div
      className="min-h-screen bg-[#0C0C0C] text-white"
      style={{ fontFamily: "'Kanit', sans-serif" }}
    >
      <Navbar variant="app" />

      <main className="relative mx-auto max-w-4xl px-4 pb-24 pt-28 sm:px-6">
        <GlowBackground />

        <div className="relative">
          <h1
            className="text-4xl font-bold text-transparent sm:text-5xl"
            style={{
              backgroundImage: 'linear-gradient(180deg, #646973 0%, #BBCCD7 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
            }}
          >
            Run a review
          </h1>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <div
              role="tablist"
              aria-label="Review mode"
              className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1"
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    tab === t.id
                      ? 'bg-white text-black'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {clearAction && (
              <Button variant="ghost" onClick={clearAction} className="text-sm">
                Clear
              </Button>
            )}
          </div>

          {/* Panels stay MOUNTED and are toggled with `hidden`, so switching
              tabs preserves the pasted diff / PR title / repo URL that live in
              each input's local state. */}
          <div className="mt-8 space-y-8">
            <div className={tab === 'diff' ? 'space-y-8' : 'hidden'}>
              <DiffInput />
              {review.loading && <LoadingRow />}
              {review.error && <ErrorMessage message={review.error} />}
              {review.data && <ReviewResult result={review.data} />}
            </div>

            <div className={tab === 'repo' ? 'space-y-8' : 'hidden'}>
              <RepoUrlInput />
              {repoReview.loading && <LoadingRow />}
              {repoReview.error && <ErrorMessage message={repoReview.error} />}
              {repoReview.data && (
                <>
                  <RepoScoreSummary result={repoReview.data} />
                  <FileReviewList files={repoReview.data.fileReviews} />
                </>
              )}
            </div>

            <div className={tab === 'rules' ? '' : 'hidden'}>
              <RulesManager />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
