import type { Config } from '../../config.js';
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
  const raw = asRecord(await generateJson(config, buildDiffPrompt(input)));
  return {
    ...(input.prTitle ? { prTitle: input.prTitle } : {}),
    overallScore: clampScore(raw.overallScore),
    categories: normalizeCategories(raw.categories),
    markdownComment:
      typeof raw.markdownComment === 'string' ? raw.markdownComment : '',
  };
}

export async function reviewFile(
  config: Config,
  input: { filePath: string; content: string; customRules?: CustomRule[] },
): Promise<{ score: number; categories: ReviewCategory[] }> {
  const raw = asRecord(await generateJson(config, buildFilePrompt(input)));
  return {
    score: clampScore(raw.score),
    categories: normalizeCategories(raw.categories),
  };
}
