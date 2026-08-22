import { Sparkles, Cpu } from 'lucide-react';
import type { ReasoningEngine } from '@oncall/shared';
import { Icon } from '../../../components/primitives/Icon';
import { tint } from '../../../lib/tokens';

/**
 * Small provenance chip for a reasoning result — which engine produced it. AI
 * engines (Claude / Gemini) get the accent Sparkles treatment; the deterministic
 * `heuristic` fallback is a neutral chip, so a demo viewer can tell at a glance
 * whether the model was in the loop or the evidence-only fallback ran.
 */

const LABEL: Record<ReasoningEngine, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  heuristic: 'Heuristic',
};

export function EngineBadge({ engine }: { engine: ReasoningEngine }) {
  const isAi = engine !== 'heuristic';
  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-pill px-2 text-label uppercase tracking-wide"
      style={{
        backgroundColor: isAi ? tint('accent', 14) : 'var(--surface-3)',
        color: isAi ? 'var(--accent-text)' : 'var(--ink-2)',
      }}
      title={isAi ? `Reasoned by ${LABEL[engine]}` : 'Deterministic fallback (no model)'}
    >
      <Icon icon={isAi ? Sparkles : Cpu} size={12} />
      {LABEL[engine]}
    </span>
  );
}
