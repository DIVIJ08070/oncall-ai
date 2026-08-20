import { useState } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Button, ErrorMessage, Spinner } from '../components/ui';
import {
  AtmosphereBackdrop,
  Grain,
  HudCorners,
  MonoTag,
  Scanlines,
} from '../../../components/atmosphere';
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
    <div className="flex items-center gap-3 py-8 text-ink-muted-text">
      <Spinner className="text-accent" />
      <span className="text-sm uppercase tracking-[0.18em]">
        Analyzing<span className="crt-cursor" />
      </span>
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
    <div className="relative min-h-screen bg-bg text-ink">
      {/* Atmosphere: full-bleed HUD grid behind everything, plus a fixed
          film-grain overlay across the viewport. Purely decorative. */}
      <AtmosphereBackdrop />
      <Grain />
      <Scanlines />

      <div className="relative z-10">
        <Navbar variant="app" />

        <main className="relative mx-auto max-w-4xl px-4 pb-24 pt-28 sm:px-6">
          <div className="relative">
            <div className="mb-4">
              <MonoTag>REVIEW / ENGINE</MonoTag>
            </div>

            <h1 className="crt-glow-strong text-4xl font-bold uppercase tracking-tight text-ink sm:text-5xl">
              <span aria-hidden className="text-accent">
                &gt;{' '}
              </span>
              Run a review
            </h1>

            {/* Main tool panel framed by hairline viewfinder brackets. */}
            <div className="relative mt-10">
              <HudCorners size={16} inset={-12} />

              <div className="flex flex-wrap items-center gap-3">
                <div
                  role="tablist"
                  aria-label="Review mode"
                  className="inline-flex rounded-sm border border-border bg-surface-2 p-1"
                >
                  {tabs.map((t) => {
                    const active = tab === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setTab(t.id)}
                        style={{
                          boxShadow: active
                            ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent)'
                            : undefined,
                        }}
                        className={`rounded-[3px] px-3.5 py-1.5 text-[11px] uppercase tracking-[0.18em] transition-colors ${
                          active
                            ? 'crt-glow bg-surface-3 text-accent-text'
                            : 'text-ink-muted-text hover:text-ink-2'
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                {clearAction && (
                  <Button
                    variant="ghost"
                    onClick={clearAction}
                    className="text-sm"
                  >
                    Clear
                  </Button>
                )}
              </div>

              {/* Panels stay MOUNTED and are toggled with `hidden`, so switching
                  tabs preserves the pasted diff / PR title / repo URL that live
                  in each input's local state. */}
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
                  {repoReview.error && (
                    <ErrorMessage message={repoReview.error} />
                  )}
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
          </div>
        </main>
      </div>
    </div>
  );
}
