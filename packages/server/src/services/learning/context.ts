import type { Daos } from '../../db/dao/index.js';

/**
 * Self-learning — prompt-context assembly (per-repo learnings → LLM prompts).
 *
 * `buildLearnedContext` renders the top learnings for a repo ("owner/name") as
 * a plain-text block (clear heading + numbered lessons) that callers PREPEND
 * to the investigation / code-review prompts when non-empty. It never throws:
 * any DAO failure (including the learnings table not existing yet) degrades to
 * `''` so every prompt falls back to its unaugmented form — self-learning is
 * strictly additive and must never break an investigation or review.
 */

/** Max learnings injected into any single prompt. */
const MAX_PROMPT_LEARNINGS = 8;
/** Per-field cap so one verbose learning cannot dominate the prompt. */
const MAX_FIELD_CHARS = 280;

/** Whitespace-collapse + hard cap (adds an ellipsis when clipped). */
function clip(text: string, max = MAX_FIELD_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Render the learned-context block for `repo`, or `''` when the repo has no
 * learnings (or the learnings store is unavailable). Positive-rated, most-
 * confirmed learnings come first (`topForPrompt` ordering).
 */
export async function buildLearnedContext(
  dao: Daos,
  repo: string,
  limit = MAX_PROMPT_LEARNINGS,
): Promise<string> {
  try {
    const learnings = await dao.repoLearnings.topForPrompt(repo, limit);
    if (learnings.length === 0) return '';

    const lines = learnings.map((l, i) => {
      const outcome =
        l.rating > 0 ? 'worked' : l.rating < 0 ? 'did NOT work' : 'outcome unknown';
      const parts = [
        `${i + 1}. [${clip(l.error_class, 80)}] Root cause: ${clip(l.root_cause)}`,
      ];
      if (l.fix_approach) {
        parts.push(`   Fix approach (${outcome}): ${clip(l.fix_approach)}`);
      } else {
        parts.push(`   Outcome: ${outcome}`);
      }
      parts.push(`   (source: ${l.source}, confirmed ${l.confirmations}x)`);
      return parts.join('\n');
    });

    return [
      `LEARNED CONTEXT — lessons from past incidents & reviews in ${repo}:`,
      'These were learned from earlier AI fixes and human feedback on this repository.',
      'Use them to form hypotheses faster, but ALWAYS verify against live evidence.',
      '',
      ...lines,
    ].join('\n');
  } catch {
    // Self-learning is strictly additive — never let it break a prompt build.
    return '';
  }
}
