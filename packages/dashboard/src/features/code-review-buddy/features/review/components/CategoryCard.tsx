import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ReviewBadge } from '../../../components/ui';
import type { ReviewCategory } from '../../../lib/types';

interface CategoryCardProps {
  category: ReviewCategory;
}

const COLLAPSE_THRESHOLD = 3;

/**
 * THE single renderer for a review category's findings — used by the diff
 * review, every file card in the repo review, and anywhere else findings
 * appear. Never fork this component.
 */
export function CategoryCard({ category }: CategoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = category.findings.length > COLLAPSE_THRESHOLD;
  const visibleFindings =
    collapsible && !expanded
      ? category.findings.slice(0, COLLAPSE_THRESHOLD)
      : category.findings;

  return (
    <div className="rounded-sm border border-border bg-surface-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium uppercase tracking-[0.08em] text-ink">{category.name}</h3>
        <ReviewBadge severity={category.severity} />
      </div>

      <p className="mt-2 text-sm text-ink-2">{category.summary}</p>

      {category.findings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {visibleFindings.map((finding, i) => (
            <li key={i} className="flex gap-2 text-sm text-ink-2">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
              <span>{finding}</span>
            </li>
          ))}
        </ul>
      )}

      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium uppercase tracking-[0.08em] text-ink-muted-text transition-colors hover:text-ink"
        >
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
          {expanded
            ? 'Show less'
            : `Show all ${category.findings.length} findings`}
        </button>
      )}
    </div>
  );
}
