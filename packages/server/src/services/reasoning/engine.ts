import type { Config } from '../../config.js';
import { claudeGenerateText } from '../code-review/claude.js';

/**
 * Shared JSON reasoning engine (Phase 5 — "Ask Why" + "What Changed?"). Same
 * engine priority as Code Review Buddy / the Momo assistant: Claude first (the
 * developer's subscription, via the shared `claudeGenerateText` runner), Gemini
 * fallback (plain fetch). It adds **no new model auth** — it reuses the exact
 * subscription path the investigation agent and code review already use.
 *
 * The caller supplies a task-specific system prompt and gets back parsed JSON
 * plus which engine produced it. Callers wrap this in a try/catch and degrade to
 * a deterministic heuristic when neither engine is available, so the reasoning
 * features never hard-depend on the model being up.
 */

export type ReasoningModelEngine = 'claude' | 'gemini';

/** After a Claude failure, skip Claude for a while (same policy as the others). */
let claudeCooldownUntil = 0;
const CLAUDE_COOLDOWN_MS = 90_000;

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** JSON.parse with fallbacks: strip ```json fences, then leading/trailing prose. */
export function parseModelJson(raw: string): unknown {
  const attempts: string[] = [raw.trim()];

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) attempts.push(fenced[1]!.trim());

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

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
  }>;
}

async function geminiJson(
  config: Config,
  prompt: string,
  systemPrompt: string,
): Promise<string> {
  const url =
    `${GEMINI_BASE}/${encodeURIComponent(config.codeReview.model)}` +
    `:generateContent?key=${encodeURIComponent(config.codeReview.geminiApiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(45_000),
  }).catch(() => {
    throw new Error('The Gemini API did not respond in time.');
  });

  if (!res.ok) {
    throw new Error(`The Gemini API returned HTTP ${res.status}.`);
  }

  const payload = (await res.json().catch(() => null)) as GeminiResponse | null;
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('The Gemini API returned an empty response.');
  }
  return text.trim();
}

/**
 * Generate a JSON object from `prompt`/`systemPrompt` via the shared engine.
 * Throws when no engine is available (Claude down + no Gemini key) or the model
 * returns unparseable output — callers catch and fall back to a heuristic.
 */
export async function generateReasoningJson(
  config: Config,
  prompt: string,
  systemPrompt: string,
): Promise<{ json: unknown; engine: ReasoningModelEngine }> {
  const mode = config.codeReview.engine; // 'auto' | 'claude' | 'gemini'
  const tryClaude = mode !== 'gemini' && Date.now() >= claudeCooldownUntil;

  if (tryClaude) {
    try {
      const text = await claudeGenerateText(config, prompt, systemPrompt);
      const json = parseModelJson(text);
      if (json === undefined) throw new Error('Claude returned unparseable JSON');
      return { json, engine: 'claude' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mode === 'claude') throw err;
      claudeCooldownUntil = Date.now() + CLAUDE_COOLDOWN_MS;
      // eslint-disable-next-line no-console
      console.warn(
        '[reasoning] Claude engine failed (%s) — using Gemini for the next 90s.',
        msg,
      );
    }
  }

  if (!config.codeReview.geminiApiKey) {
    throw new Error(
      'The Claude engine was unavailable and GEMINI_API_KEY is not set.',
    );
  }
  const text = await geminiJson(config, prompt, systemPrompt);
  const json = parseModelJson(text);
  if (json === undefined) throw new Error('Gemini returned unparseable JSON');
  return { json, engine: 'gemini' };
}
