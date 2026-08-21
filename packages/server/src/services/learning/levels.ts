/**
 * Self-learning level ladder. A repo's level is a function of how many
 * learnings it has accumulated (`stats.total`): the more confirmed feedback the
 * agent has absorbed for a repo, the higher its rank.
 */

/** Rank ladder: a repo holds the highest level whose threshold it has reached. */
export const LEVELS = [
  { name: 'OBSERVER', threshold: 0 },
  { name: 'APPRENTICE', threshold: 5 },
  { name: 'RESIDENT', threshold: 15 },
  { name: 'SPECIALIST', threshold: 30 },
  { name: 'VETERAN', threshold: 60 },
  { name: 'ORACLE', threshold: 100 },
] as const;

export type LevelName = (typeof LEVELS)[number]['name'];

export interface LearningLevel {
  /** Index into `LEVELS` (0 = OBSERVER). */
  index: number;
  name: LevelName;
  /** The learning count the level was computed from. */
  total: number;
  /** Threshold of the next level, or `null` at the top rank. */
  nextAt: number | null;
  /** Progress toward `nextAt` within the current band (0..1; 1 at the top). */
  progress: number;
}

/** Compute the level payload for a repo's total learning count. */
export function computeLevel(total: number): LearningLevel {
  const count = Math.max(0, Math.floor(total));
  let index = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (count >= LEVELS[i].threshold) {
      index = i;
      break;
    }
  }
  const nextAt = index + 1 < LEVELS.length ? LEVELS[index + 1].threshold : null;
  const base = LEVELS[index].threshold;
  const progress =
    nextAt === null ? 1 : Math.min(1, (count - base) / (nextAt - base));
  return { index, name: LEVELS[index].name, total: count, nextAt, progress };
}
