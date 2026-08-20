import { useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { severityColor } from '../../../components/ui';
import type { AutoReview } from '../../../lib/types';
import { CategoryCard } from '../../review/components/CategoryCard';
import { ReviewScore } from '../../review/components/ReviewScore';
import { timeAgo } from './time';

/** "commented on PR" vs "review stored locally" pill. */
function CommentedBadge({ commented }: { commented: boolean }) {
  const color = commented ? severityColor('passed') : 'rgba(255,255,255,0.45)';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style={{
        color,
        borderColor: commented ? `${severityColor('passed')}44` : 'rgba(255,255,255,0.15)',
        backgroundColor: commented ? `${severityColor('passed')}1a` : 'rgba(255,255,255,0.05)',
      }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {commented ? 'commented on PR' : 'review stored locally'}
    </span>
  );
}

interface AutoReviewCardProps {
  review: AutoReview;
}

/**
 * One entry in the auto-review feed. The body renders findings through the
 * shared CategoryCard from the diff review — never a fork of it.
 */
export function AutoReviewCard({ review }: AutoReviewCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
      <div
        className="flex w-full cursor-pointer items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[0.04]"
        onClick={() => setOpen((v) => !v)}
      >
        <ReviewScore score={review.overallScore} size="sm" />

        <div className="min-w-0 flex-1">
          <a
            href={review.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-white/90 transition-colors hover:text-white"
          >
            <span className="truncate">
              PR #{review.prNumber} — {review.prTitle}
            </span>
            <ExternalLink size={13} className="shrink-0 text-white/40" />
          </a>

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span
              className="text-xs text-white/40"
              style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
            >
              {review.owner}/{review.repo} · {review.headSha.slice(0, 7)}
            </span>
            <CommentedBadge commented={review.commented} />
            <span className="text-xs text-white/40">{timeAgo(review.reviewedAt)}</span>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Collapse review' : 'Expand review'}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ChevronDown
            size={18}
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-white/10 p-4">
          {review.categories.length === 0 ? (
            <p className="text-sm text-white/50">No findings for this pull request.</p>
          ) : (
            review.categories.map((category) => (
              <CategoryCard key={category.name} category={category} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
