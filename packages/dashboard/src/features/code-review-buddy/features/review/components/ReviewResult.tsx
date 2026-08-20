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
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:flex-row sm:gap-6">
        <ReviewScore score={result.overallScore} size="lg" />
        <div className="text-center sm:text-left">
          {result.prTitle && (
            <h2 className="text-xl font-semibold text-white">{result.prTitle}</h2>
          )}
          <p className="mt-1 text-sm text-white/50">
            Overall score across {result.categories.length} categories
          </p>
          {result.engine && (
            <span
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-white/60"
              title={
                result.engine === 'claude'
                  ? 'Reviewed by Claude (subscription) — preferred engine'
                  : 'Reviewed by Gemini (fallback engine)'
              }
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: result.engine === 'claude' ? '#f97316' : '#3b82f6' }}
              />
              engine: {result.engine}
            </span>
          )}
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
