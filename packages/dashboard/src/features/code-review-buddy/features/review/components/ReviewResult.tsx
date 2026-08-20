import type { ReviewResult as ReviewResultData } from '../../../lib/types';
import { CategoryCard } from './CategoryCard';
import { CopyReviewButton } from './CopyReviewButton';
import { ReviewScore } from './ReviewScore';

interface ReviewResultProps {
  result: ReviewResultData;
}

export function ReviewResult({ result }: ReviewResultProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4 rounded-sm border border-border bg-surface-2 p-6 sm:flex-row sm:gap-6">
        <ReviewScore score={result.overallScore} size="lg" />
        <div className="text-center sm:text-left">
          {result.prTitle && (
            <h2 className="crt-glow text-xl font-semibold text-ink">{result.prTitle}</h2>
          )}
          <p className="mt-1 text-sm text-ink-muted-text">
            Overall score across {result.categories.length} categories
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {result.categories.map((category) => (
          <CategoryCard key={category.name} category={category} />
        ))}
      </div>

      <div className="flex justify-end">
        <CopyReviewButton markdown={result.markdownComment} />
      </div>
    </div>
  );
}
