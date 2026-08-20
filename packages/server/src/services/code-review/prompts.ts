import type { CustomRule } from './types.js';

/**
 * Code Review Buddy — prompt assembly. The reviewer instruction is the product
 * spec's wording verbatim; the per-file variant swaps only the response shape
 * (`{ score, categories }`) and asks for approximate line numbers.
 */

const REVIEWER_PREAMBLE =
  'You are an expert senior software engineer performing a pull request code review. ' +
  'Analyze the provided code for: bugs and logic errors, security vulnerabilities, ' +
  'code smells, missing test coverage, and best-practice violations. If custom ' +
  'project rules are provided, also check for violations of those and report them ' +
  "under a category called 'Custom Rules' using the severity given for each rule " +
  '(error→high, warning→medium unless truly worse).';

const CATEGORY_RULES =
  'severity must be one of critical, high, medium, low, passed. Category names ' +
  'must be among: Bugs, Security, Code Smells, Missing Tests, Best Practices, ' +
  "Custom Rules. Include all five base categories (use severity 'passed' with an " +
  'empty findings list when clean).';

/** Full-diff reviewer instruction (exact product-spec text). */
export const DIFF_REVIEWER_INSTRUCTION =
  `${REVIEWER_PREAMBLE} Respond with ONLY a JSON object (no markdown, no code ` +
  'fences) matching exactly: { overallScore: number, categories: [{ name, ' +
  'severity, summary, findings: string[] }], markdownComment: string }. ' +
  CATEGORY_RULES;

/** Per-file reviewer instruction — same rules, `{ score, categories }` shape. */
export const FILE_REVIEWER_INSTRUCTION =
  `${REVIEWER_PREAMBLE} Respond with ONLY a JSON object (no markdown, no code ` +
  'fences) matching exactly: { score: number, categories: [{ name, severity, ' +
  'summary, findings: string[] }] }. ' +
  CATEGORY_RULES;

/** Only ENABLED rules reach the model; disabled ones are invisible to it. */
function formatCustomRules(rules: CustomRule[] | undefined): string {
  const enabled = (rules ?? []).filter((r) => r.enabled);
  if (enabled.length === 0) return '';
  const lines = enabled
    .map((r) => `- [${r.severity}] (${r.category}) ${r.description}`)
    .join('\n');
  return `\n\nCustom project rules to enforce:\n${lines}`;
}

export function buildDiffPrompt(input: {
  diff: string;
  prTitle?: string;
  customRules?: CustomRule[];
}): string {
  const title = input.prTitle ? `\n\nPull request title: ${input.prTitle}` : '';
  return (
    `${DIFF_REVIEWER_INSTRUCTION}${title}${formatCustomRules(input.customRules)}` +
    `\n\nUnified diff to review:\n${input.diff}`
  );
}

export function buildFilePrompt(input: {
  filePath: string;
  content: string;
  customRules?: CustomRule[];
}): string {
  return (
    `${FILE_REVIEWER_INSTRUCTION} Findings should reference approximate line ` +
    `numbers in the file (e.g. "~line 42: ...").` +
    formatCustomRules(input.customRules) +
    `\n\nFile path: ${input.filePath}\n\nFile content:\n${input.content}`
  );
}
