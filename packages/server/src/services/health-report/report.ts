import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { claudeGenerateText } from '../code-review/claude.js';
import { CodeReviewError } from '../code-review/types.js';
import { analyzeRepoStatic, type StaticScan } from './scan.js';

const execFileAsync = promisify(execFile);

/**
 * Project Health — report runner. Shallow-clones a public GitHub repo into a
 * tmp dir, runs the static scanner, then asks an AI engine (Claude first via
 * the developer's subscription CLI — same transport as Code Review Buddy —
 * with Gemini as fallback) to write the qualitative half of the report. The
 * AI JSON is zod-validated (one "fix your JSON" retry) and merged with the
 * static-scan facts into the shared `HealthReport` contract shape.
 */

/* ── shared contract shape ──────────────────────────────────────────────── */

export interface HealthReport {
  score: number;
  grade: string;
  summary: string;
  stats: {
    files: number;
    linesOfCode: number;
    languages: { name: string; pct: number }[];
  };
  frameworks: string[];
  apis: { method: string; path: string; file: string }[];
  databases: { type: string; evidence: string }[];
  quality: {
    strengths: string[];
    issues: {
      severity: 'critical' | 'warning' | 'info';
      title: string;
      detail: string;
      file?: string;
    }[];
    suggestions: string[];
  };
  security: { findings: string[]; secretsFound: boolean };
  tests: { present: boolean; note: string };
  docs: { present: boolean; note: string };
  engine: 'claude' | 'gemini';
}

/* ── AI output schema (quality half only; facts come from the scanner) ──── */

const AiIssueSchema = z.object({
  severity: z.enum(['critical', 'warning', 'info']).catch('info'),
  title: z.string().min(1),
  detail: z.string().default(''),
  file: z.string().optional(),
});

const AiReportSchema = z.object({
  score: z.coerce.number(),
  grade: z.string().default(''),
  summary: z.string().min(1),
  strengths: z.array(z.string()).default([]),
  issues: z.array(AiIssueSchema).default([]),
  suggestions: z.array(z.string()).default([]),
  testsNote: z.string().default(''),
  docsNote: z.string().default(''),
});
type AiReport = z.infer<typeof AiReportSchema>;

/* ── clone ──────────────────────────────────────────────────────────────── */

const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(?:\.git)?\/?$/;
const CLONE_TIMEOUT_MS = 120_000;
const DIGEST_BUDGET = 18_000;

async function shallowClone(repoUrl: string, dir: string): Promise<void> {
  try {
    await execFileAsync(
      'git',
      ['clone', '--depth', '1', '--single-branch', repoUrl, dir],
      {
        timeout: CLONE_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true' },
        maxBuffer: 4 * 1024 * 1024,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|repository .* does not exist|403|404/i.test(msg)) {
      throw new CodeReviewError(
        404,
        'not_found',
        'Repository not found — is it a public GitHub repo?',
      );
    }
    throw new CodeReviewError(
      502,
      'upstream_error',
      `git clone failed: ${msg.split('\n')[0]}`,
    );
  }
}

/* ── digest (compact repo snapshot for the prompt, ~18k chars) ──────────── */

const KEY_FILE_RE =
  /(^|\/)(index|main|app|server|api|routes?|__init__)\.(ts|tsx|js|jsx|mjs|py|go|rb|java)$/i;
const MANIFEST_NAMES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'dockerfile',
  'docker-compose.yml',
]);

function head(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;
}

function safeRead(dir: string, rel: string, max: number): string {
  try {
    const buf = fs.readFileSync(path.join(dir, rel));
    if (buf.includes(0)) return '';
    return head(buf.toString('utf8'), max);
  } catch {
    return '';
  }
}

function buildDigest(dir: string, repoUrl: string, scan: StaticScan): string {
  const parts: string[] = [];

  parts.push(`Repository: ${repoUrl}`);
  parts.push(
    `Static scan: ${scan.files} files, ${scan.linesOfCode} lines of code. ` +
      `Languages: ${scan.languages.map((l) => `${l.name} ${l.pct}%`).join(', ') || 'none detected'}. ` +
      `Frameworks: ${scan.frameworks.join(', ') || 'none detected'}. ` +
      `API endpoints found: ${scan.apis.length}. ` +
      `Databases: ${scan.databases.map((d) => d.type).join(', ') || 'none detected'}. ` +
      `Tests: ${scan.testsNote} Docs: ${scan.docsNote} ` +
      `Secrets flagged: ${scan.secretFindings.length}.`,
  );

  // file tree — top two levels
  const treeLines: string[] = [];
  const seenDirs = new Set<string>();
  for (const f of scan.walkedFiles) {
    const segs = f.path.split('/');
    if (segs.length === 1) {
      treeLines.push(segs[0]);
    } else {
      const top = segs.length === 2 ? f.path : `${segs[0]}/${segs[1]}/…`;
      if (!seenDirs.has(top)) {
        seenDirs.add(top);
        treeLines.push(top);
      }
    }
    if (treeLines.length >= 120) break;
  }
  parts.push(`File tree (top levels):\n${treeLines.join('\n')}`);

  // README head
  const readme = safeRead(dir, 'README.md', 2000);
  if (readme) parts.push(`README.md (head):\n${readme}`);

  // manifests
  for (const f of scan.walkedFiles) {
    if (MANIFEST_NAMES.has(path.basename(f.path).toLowerCase()) && f.path.split('/').length <= 2) {
      const content = safeRead(dir, f.path, 1500);
      if (content) parts.push(`--- ${f.path} ---\n${content}`);
    }
  }

  // sampled key source files: entry-point-looking names first, then largest sources
  const sourceFiles = scan.walkedFiles.filter((f) =>
    /\.(ts|tsx|js|jsx|mjs|py|go|rb|java|cs|rs|php)$/i.test(f.path),
  );
  const keyFiles = sourceFiles.filter((f) => KEY_FILE_RE.test(f.path));
  const bySize = [...sourceFiles].sort((a, b) => b.size - a.size);
  const sampled: string[] = [];
  for (const f of [...keyFiles, ...bySize]) {
    if (sampled.length >= 8) break;
    if (!sampled.includes(f.path)) sampled.push(f.path);
  }
  for (const rel of sampled) {
    const remaining = DIGEST_BUDGET - parts.join('\n\n').length;
    if (remaining < 500) break;
    const content = safeRead(dir, rel, Math.min(1600, remaining - 100));
    if (content) parts.push(`--- ${rel} ---\n${content}`);
  }

  return head(parts.join('\n\n'), DIGEST_BUDGET);
}

/* ── AI call: Claude first, Gemini fallback ─────────────────────────────── */

const HEALTH_SYSTEM_PROMPT =
  'You are a software project health analyst. Respond with ONLY the JSON ' +
  'object the user requests — no markdown, no code fences, no commentary ' +
  'before or after.';

function buildPrompt(digest: string): string {
  return (
    'Assess the health of the following software repository from the digest ' +
    'below (static-scan stats, file tree, manifests, and sampled source files).\n\n' +
    'Return ONLY a JSON object with EXACTLY these keys:\n' +
    '{\n' +
    '  "score": <integer 0-100, overall project health>,\n' +
    '  "grade": <"A"|"B"|"C"|"D"|"F", consistent with the score>,\n' +
    '  "summary": <3-5 sentence plain-English overview: what the project does, how healthy it is, the biggest risk>,\n' +
    '  "strengths": [<3-6 short strings, concrete things done well>],\n' +
    '  "issues": [{"severity": "critical"|"warning"|"info", "title": <short>, "detail": <1-2 sentences>, "file": <optional repo-relative path>}],\n' +
    '  "suggestions": [<3-6 short actionable improvement strings>],\n' +
    '  "testsNote": <one sentence on test coverage/setup>,\n' +
    '  "docsNote": <one sentence on documentation quality>\n' +
    '}\n\n' +
    'Judge realistically: missing tests, no CI, hardcoded secrets, huge files, ' +
    'and absent docs should lower the score; clear structure, typing, tests, ' +
    'and docs raise it. 4-10 issues, ordered most severe first.\n\n' +
    `=== REPOSITORY DIGEST ===\n${digest}`
  );
}

/** After a Claude failure, skip Claude for a while (same policy as code-review). */
let claudeCooldownUntil = 0;
const CLAUDE_COOLDOWN_MS = 90_000;

export async function generateHealthText(
  config: Config,
  prompt: string,
): Promise<{ text: string; engine: 'claude' | 'gemini' }> {
  const mode = config.codeReview.engine; // 'auto' | 'claude' | 'gemini'
  const tryClaude = mode !== 'gemini' && Date.now() >= claudeCooldownUntil;

  if (tryClaude) {
    try {
      const text = await claudeGenerateText(config, prompt, HEALTH_SYSTEM_PROMPT);
      return { text, engine: 'claude' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mode === 'claude') {
        throw err instanceof CodeReviewError
          ? err
          : new CodeReviewError(502, 'upstream_error', `The Claude engine failed: ${msg}`);
      }
      claudeCooldownUntil = Date.now() + CLAUDE_COOLDOWN_MS;
      // eslint-disable-next-line no-console
      console.warn(
        '[health-report] Claude engine failed (%s) — using Gemini for the next 90s.',
        msg,
      );
    }
  }

  if (!config.codeReview.geminiApiKey) {
    throw new CodeReviewError(
      503,
      'upstream_error',
      'The Claude engine (Claude Code subscription) was unavailable and GEMINI_API_KEY is not set — sign in to Claude Code on this machine or add a Gemini key to .env.',
    );
  }
  return { text: await geminiGenerate(config, prompt), engine: 'gemini' };
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
}

async function geminiGenerate(config: Config, prompt: string): Promise<string> {
  const url =
    `${GEMINI_BASE}/${encodeURIComponent(config.codeReview.model)}` +
    `:generateContent?key=${encodeURIComponent(config.codeReview.geminiApiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: HEALTH_SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => {
    throw new CodeReviewError(
      502,
      'upstream_error',
      'The Gemini API did not respond in time — try again in a moment.',
    );
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new CodeReviewError(
        429,
        'rate_limited',
        'Gemini free-tier rate limit reached — wait a minute and retry.',
      );
    }
    throw new CodeReviewError(
      502,
      'upstream_error',
      `The Gemini API returned HTTP ${res.status} — verify GEMINI_API_KEY, then try again.`,
    );
  }

  const payload = (await res.json().catch(() => null)) as GeminiResponse | null;
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new CodeReviewError(
      502,
      'upstream_error',
      'The Gemini API returned an empty response — try again in a moment.',
    );
  }
  return text;
}

/** JSON.parse with fallbacks: strip ```json fences, then leading/trailing prose. */
export function parseModelJson(raw: string): unknown {
  const attempts: string[] = [raw.trim()];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) attempts.push(fenced[1].trim());
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) attempts.push(raw.slice(first, last + 1));
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next, more aggressive extraction
    }
  }
  return undefined;
}

/** One shot + one "fix your JSON" retry, zod-validated. */
async function generateAiReport(
  config: Config,
  digest: string,
): Promise<{ ai: AiReport; engine: 'claude' | 'gemini' }> {
  const prompt = buildPrompt(digest);
  const first = await generateHealthText(config, prompt);
  const firstParsed = AiReportSchema.safeParse(parseModelJson(first.text));
  if (firstParsed.success) return { ai: firstParsed.data, engine: first.engine };

  const retryPrompt =
    `${prompt}\n\nYour previous response could not be parsed as the requested ` +
    `JSON object (error: ${firstParsed.error.issues[0]?.message ?? 'invalid JSON'}). ` +
    `Previous response (may be truncated):\n${head(first.text, 2000)}\n\n` +
    'Fix your JSON: respond again with ONLY the valid JSON object, exactly the keys specified.';
  const second = await generateHealthText(config, retryPrompt);
  const secondParsed = AiReportSchema.safeParse(parseModelJson(second.text));
  if (secondParsed.success) return { ai: secondParsed.data, engine: second.engine };

  console.error('[health-report] AI JSON invalid twice', {
    engine: second.engine,
    zod: secondParsed.error.issues.slice(0, 3),
    head: second.text.slice(0, 400),
  });
  throw new CodeReviewError(
    502,
    'upstream_error',
    'The AI engine returned JSON that failed validation twice — try again in a moment.',
  );
}

/* ── merge + entry point ────────────────────────────────────────────────── */

function clampScore(v: number): number {
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 50;
}

function gradeForScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export async function runHealthReport(
  config: Config,
  repoUrl: string,
): Promise<HealthReport> {
  if (!GITHUB_URL_RE.test(repoUrl.trim())) {
    throw new CodeReviewError(
      400,
      'validation_error',
      'repoUrl must be a public GitHub repository URL like https://github.com/owner/repo',
    );
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'health-report-'));
  try {
    await shallowClone(repoUrl.trim(), tmpDir);
    const scan = analyzeRepoStatic(tmpDir);
    const digest = buildDigest(tmpDir, repoUrl, scan);
    const { ai, engine } = await generateAiReport(config, digest);

    const score = clampScore(ai.score);
    const grade = /^[A-F]$/.test(ai.grade.trim().toUpperCase())
      ? ai.grade.trim().toUpperCase()
      : gradeForScore(score);

    return {
      score,
      grade,
      summary: ai.summary,
      stats: {
        files: scan.files,
        linesOfCode: scan.linesOfCode,
        languages: scan.languages,
      },
      frameworks: scan.frameworks,
      apis: scan.apis,
      databases: scan.databases,
      quality: {
        strengths: ai.strengths,
        issues: ai.issues,
        suggestions: ai.suggestions,
      },
      security: {
        findings: scan.secretFindings,
        secretsFound: scan.secretsFound,
      },
      tests: {
        present: scan.testsPresent,
        note: ai.testsNote || scan.testsNote,
      },
      docs: {
        present: scan.docsPresent,
        note: ai.docsNote || scan.docsNote,
      },
      engine,
    };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
