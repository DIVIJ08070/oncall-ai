/**
 * REAL AI review findings — verbatim output of Code Review Buddy's Claude
 * engine on this repo's actual pull requests (stored by the PR watcher).
 * These are the constellation of Act 08: proof, not testimonials.
 */
export interface RealFinding {
  sev: 'critical' | 'high' | 'medium' | 'low';
  cat: string;
  pr: number;
  text: string;
}

export const REAL_FINDINGS: RealFinding[] = [
  { sev: 'high', cat: 'Missing Tests', pr: 3, text: 'No test asserts that POST /checkout falls back to bodyItems (or []) when getSessionCart(req) returns a nullish value.' },
  { sev: 'medium', cat: 'Bugs', pr: 3, text: 'getSessionCart is declared to return Cart (non-nullable), yet the fix assumes it can be null/undefined.' },
  { sev: 'medium', cat: 'Code Smells', pr: 4, text: 'getSessionCart is typed to always return Cart, yet callers must defensively use ?. — the safety net relies on a type lie.' },
  { sev: 'high', cat: 'Missing Tests', pr: 4, text: 'This PR reverts a regression caused by removing a null check, but the diff adds no test exercising that path.' },
  { sev: 'medium', cat: 'Best Practices', pr: 5, text: 'Update getSessionCart’s return type (e.g. Cart | undefined) to honestly reflect that it can return a falsy value.' },
  { sev: 'low', cat: 'Bugs', pr: 5, text: 'The fix reinstates ?. on getSessionCart(req).items — correct only if the function can actually return a falsy cart.' },
  { sev: 'medium', cat: 'Code Smells', pr: 12, text: 'reportQuery returns hardcoded data ({ rows: 128 }) — a placeholder standing in for real report generation.' },
  { sev: 'high', cat: 'Bugs', pr: 7, text: 'Accessing .items on a potentially undefined session cart will throw a TypeError on every anonymous checkout.' },
  { sev: 'medium', cat: 'Best Practices', pr: 8, text: 'Prefer a database transaction around the paired writes so a mid-flight failure cannot leave half-applied state.' },
  { sev: 'low', cat: 'Code Smells', pr: 6, text: 'Consider extracting the repeated cart-fallback logic into a single helper instead of three inline copies.' },
];
