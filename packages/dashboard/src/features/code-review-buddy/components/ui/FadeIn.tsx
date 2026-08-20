import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { prefersStaticEntrance } from '../../lib/motion';

interface FadeInProps {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}

/**
 * Scroll-entrance reveal. Honors the CRITICAL ANIMATION RULE: when the
 * document is hidden (embedded previews freeze rAF) or the user prefers
 * reduced motion, content renders fully visible with no animation.
 */
export function FadeIn({ children, delay = 0, y = 24, className }: FadeInProps) {
  if (prefersStaticEntrance()) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
