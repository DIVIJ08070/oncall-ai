import { motion } from 'framer-motion';
import { prefersStaticEntrance } from '../../lib/motion';

interface AnimatedTextProps {
  text: string;
  className?: string;
  delay?: number;
}

/**
 * Per-word staggered rise. Honors the CRITICAL ANIMATION RULE: renders the
 * plain text immediately when the document is hidden or reduced motion is on.
 */
export function AnimatedText({ text, className, delay = 0 }: AnimatedTextProps) {
  if (prefersStaticEntrance()) {
    return <span className={className}>{text}</span>;
  }

  const words = text.split(' ');

  return (
    <span className={className} aria-label={text}>
      {words.map((word, i) => (
        // The inter-word space is a real text node BETWEEN the clip wrappers,
        // never inside overflow-hidden (a trailing space there collapses and
        // runs the words together in real browsers).
        <span key={`${word}-${i}`} aria-hidden>
          <span className="inline-block overflow-hidden align-bottom">
            <motion.span
              className="inline-block"
              initial={{ y: '100%', opacity: 0 }}
              whileInView={{ y: '0%', opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: delay + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
            >
              {word}
            </motion.span>
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}
