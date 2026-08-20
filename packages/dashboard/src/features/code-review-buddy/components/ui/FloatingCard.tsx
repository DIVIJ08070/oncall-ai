import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

interface FloatingCardProps {
  children: ReactNode;
  className?: string;
  float?: boolean;
}

/** Glassy card with a gentle infinite y-float (skipped under reduced motion). */
export function FloatingCard({ children, className, float = true }: FloatingCardProps) {
  const reducedMotion = useReducedMotion();
  const shouldFloat = float && !reducedMotion;

  return (
    <motion.div
      className={`rounded-sm border border-border bg-surface-2 ${className ?? ''}`}
      animate={shouldFloat ? { y: [0, -8, 0] } : undefined}
      transition={
        shouldFloat ? { duration: 5, repeat: Infinity, ease: 'easeInOut' } : undefined
      }
    >
      {children}
    </motion.div>
  );
}
