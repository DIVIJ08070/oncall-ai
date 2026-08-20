import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { FileReviewResult } from '../../../lib/types';
import { CategoryCard } from '../../review/components/CategoryCard';
import { ReviewScore } from '../../review/components/ReviewScore';

interface FileReviewCardProps {
  file: FileReviewResult;
}

/**
 * Collapsible per-file card. The body renders findings through the shared
 * CategoryCard from the diff review — never a fork of it.
 */
export function FileReviewCard({ file }: FileReviewCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-surface-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-3"
      >
        <ReviewScore score={file.score} size="sm" />
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink-2">
          {file.filePath}
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-ink-muted-text transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-4">
          {file.categories.length === 0 ? (
            <p className="text-sm text-ink-muted-text">No findings for this file.</p>
          ) : (
            file.categories.map((category) => (
              <CategoryCard key={category.name} category={category} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
