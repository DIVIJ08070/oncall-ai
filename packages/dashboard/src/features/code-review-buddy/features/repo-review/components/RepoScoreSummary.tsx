import type { RepoReviewResult } from '../../../lib/types';
import { ReviewScore } from '../../review/components/ReviewScore';

interface RepoScoreSummaryProps {
  result: RepoReviewResult;
}

export function RepoScoreSummary({ result }: RepoScoreSummaryProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-sm border border-border bg-surface-2 p-6 sm:flex-row sm:gap-6">
      <ReviewScore score={result.overallScore} size="lg" />
      <div className="min-w-0 text-center sm:text-left">
        <h2 className="crt-glow truncate font-mono text-base text-ink">{result.repoUrl}</h2>
        <p className="mt-1 text-sm text-ink-muted-text">
          {result.filesReviewed} {result.filesReviewed === 1 ? 'file' : 'files'} reviewed
        </p>
      </div>
    </div>
  );
}
