import type { RepoReviewResult } from '../../../lib/types';
import { ReviewScore } from '../../review/components/ReviewScore';

interface RepoScoreSummaryProps {
  result: RepoReviewResult;
}

export function RepoScoreSummary({ result }: RepoScoreSummaryProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:flex-row sm:gap-6">
      <ReviewScore score={result.overallScore} size="lg" />
      <div className="min-w-0 text-center sm:text-left">
        <h2 className="truncate font-mono text-base text-white">{result.repoUrl}</h2>
        <p className="mt-1 text-sm text-white/50">
          {result.filesReviewed} {result.filesReviewed === 1 ? 'file' : 'files'} reviewed
        </p>
      </div>
    </div>
  );
}
