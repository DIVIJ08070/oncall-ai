import { useEffect, useState } from 'react';
import { severityColor } from '../../../components/ui';
import { prefersStaticEntrance } from '../../../lib/motion';

interface ReviewScoreProps {
  score: number;
  size?: 'sm' | 'lg';
}

const DIMENSIONS = {
  sm: { box: 48, stroke: 4, text: 'text-sm' },
  lg: { box: 132, stroke: 9, text: 'text-4xl' },
} as const;

function scoreColor(score: number): string {
  if (score >= 80) return severityColor('passed');
  if (score >= 60) return severityColor('medium');
  return severityColor('critical');
}

/**
 * Animated circular progress ring. The fill animates via a CSS transition on
 * stroke-dashoffset (no rAF), and renders at its final value immediately when
 * the document is hidden or reduced motion is preferred.
 */
export function ReviewScore({ score, size = 'lg' }: ReviewScoreProps) {
  const { box, stroke, text } = DIMENSIONS[size];
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const targetOffset = circumference * (1 - clamped / 100);

  const [offset, setOffset] = useState(() =>
    prefersStaticEntrance() ? targetOffset : circumference,
  );

  useEffect(() => {
    const timer = setTimeout(() => setOffset(targetOffset), 40);
    return () => clearTimeout(timer);
  }, [targetOffset]);

  const color = scoreColor(clamped);

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: box, height: box }}
      role="img"
      aria-label={`Score ${Math.round(clamped)} out of 100`}
    >
      <svg width={box} height={box} className="-rotate-90">
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={stroke}
        />
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-semibold ${text}`}
        style={{ color }}
      >
        {Math.round(clamped)}
      </span>
    </div>
  );
}
