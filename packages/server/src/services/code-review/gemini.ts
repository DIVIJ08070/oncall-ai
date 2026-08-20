import type { Config } from '../../config.js';
import { claudeGenerateText } from './claude.js';
import { buildDiffPrompt, buildFilePrompt } from './prompts.js';
import {
  CodeReviewError,
  type CategoryName,
  type CustomRule,
  type ReviewCategory,
  type ReviewResult,
  type Severity,
} from './types.js';

/**
 * Code Review Buddy — Gemini client (plain fetch, no SDK). One call per review;
 * `responseMimeType: 'application/json'` nudges the model toward raw JSON, and a
 * lenient parser + normalizer absorb whatever it actually returns. Every failure
 * is a typed `CodeReviewError` the route maps straight to the error envelope.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const MISSING_KEY_MESSAGE =
  'GEMINI_API_KEY is not set on the server — add it to .env (get a free key at ' +
  'https://aistudio.google.com/apikey) and restart.';

const SEVERITIES: readonly Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'passed',
];

/** 503 when the server has no Gemini key. Routes call this up front. */
export function assertGeminiConfigured(config: Config): void {
  if (!config.codeReview.geminiApiKey) {
    throw new CodeReviewError(503, 'upstream_error', MISSING_KEY_MESSAGE);
  }
}

/**
 * Up-front gate for review routes. Only hard-fails when the config FORCES
 * Gemini and no key is present; in auto/claude modes the Claude engine may
 * serve the request, and runtime failures surface a combined message.
 */
export function assertReviewEngineAvailable(config: Config): void {
  if (config.codeReview.engine === 'gemini') assertGeminiConfigured(config);
}

/* ── engine priority: Claude first (subscription), Gemini fallback ──────── */

export type ReviewEngine = 'claude' | 'gemini';

/** After a Claude failure, skip Claude for a while (a 15-file scan must not
 *  pay the failure latency 15 times). */
let claudeCooldownUntil = 0;
const CLAUDE_COOLDOWN_MS = 90_000; // one transient failure shouldn't bench Claude for long

async function generateReviewJson(
  config: Config,
  prompt: string,
): Promise<{ raw: unknown; engine: ReviewEngine }> {
  const mode = config.codeReview.engine; // 'auto' | 'claude' | 'gemini'
  const tryClaude = mode !== 'gemini' && Date.now() >= claudeCooldownUntil;

  if (tryClaude) {
    try {
      const text = await claudeGenerateText(config, prompt);
      const parsed = parseModelJson(text);
      if (parsed === undefined) throw new Error('Claude returned unparseable JSON');
      return { raw: parsed, engine: 'claude' };
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
        '[code-review] Claude engine failed (%s) — using Gemini for the next 90s.',
        msg,
      );
    }
  }

  if (!config.codeReview.geminiApiKey) {
    throw new CodeReviewError(
      503,
      'upstream_error',
      mode === 'gemini'
        ? MISSING_KEY_MESSAGE
        : 'The Claude engine (Claude Code subscription) was unavailable and GEMINI_API_KEY is not set — sign in to Claude Code on this machine or add a Gemini key to .env.',
    );
  }
  return { raw: await generateJson(config, prompt), engine: 'gemini' };
}

/* ── raw call + lenient JSON extraction ─────────────────────────────────── */

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
  }>;
}

async function generateJson(config: Config, prompt: string): Promise<unknown> {
  assertGeminiConfigured(config);
  const url =
    `${GEMINI_BASE}/${encodeURIComponent(config.codeReview.model)}` +
    `:generateContent?key=${encodeURIComponent(config.codeReview.geminiApiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
    // Bound the call: a stalled upstream would otherwise pin the request for
    // ~5 min (undici default), multiplied across up to 15 files on a repo scan.
    signal: AbortSignal.timeout(45_000),
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
        'Gemini free-tier rate limit reached — wait a minute and retry (or set CLAUDE_CODE_OAUTH_TOKEN so Claude is the primary engine).',
      );
    }
    throw new CodeReviewError(
      502,
      'upstream_error',
      `The Gemini API returned HTTP ${res.status} — verify GEMINI_API_KEY and CODE_REVIEW_MODEL, then try again.`,
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

  const parsed = parseModelJson(text);
  if (parsed === undefined) {
    throw new CodeReviewError(
      502,
      'upstream_error',
      'The Gemini API returned output that could not be parsed as JSON — try again.',
    );
  }
  return parsed;
}

/** JSON.parse with fallbacks: strip ```json fences, then leading/trailing prose. */
function parseModelJson(raw: string): unknown {
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

/* ── normalization (never trust model output shape) ─────────────────────── */

function clampScore(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizeSeverity(v: unknown): Severity {
  return typeof v === 'string' && (SEVERITIES as readonly string[]).includes(v)
    ? (v as Severity)
    : 'medium';
}

function normalizeFindings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((f) => (typeof f === 'string' ? f : JSON.stringify(f)));
}

function normalizeCategories(v: unknown): ReviewCategory[] {
  if (!Array.isArray(v)) return [];
  const out: ReviewCategory[] = [];
  for (const item of v) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    if (typeof c.name !== 'string' || c.name.trim() === '') continue;
    out.push({
      name: c.name as CategoryName,
      severity: normalizeSeverity(c.severity),
      summary: typeof c.summary === 'string' ? c.summary : '',
      findings: normalizeFindings(c.findings),
    });
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

/* ── public review calls ────────────────────────────────────────────────── */

export async function reviewDiff(
  config: Config,
  input: { diff: string; prTitle?: string; customRules?: CustomRule[] },
): Promise<ReviewResult> {
  const { raw: rawJson, engine } = await generateReviewJson(config, buildDiffPrompt(input));
  const raw = asRecord(rawJson);
  return {
    ...(input.prTitle ? { prTitle: input.prTitle } : {}),
    overallScore: clampScore(raw.overallScore),
    categories: normalizeCategories(raw.categories),
    markdownComment:
      typeof raw.markdownComment === 'string' ? raw.markdownComment : '',
    engine,
  };
}

export async function reviewFile(
  config: Config,
  input: { filePath: string; content: string; customRules?: CustomRule[] },
): Promise<{ score: number; categories: ReviewCategory[]; engine: ReviewEngine }> {
  const { raw: rawJson, engine } = await generateReviewJson(config, buildFilePrompt(input));
  const raw = asRecord(rawJson);
  return {
    score: clampScore(raw.score),
    categories: normalizeCategories(raw.categories),
    engine,
  };
}
