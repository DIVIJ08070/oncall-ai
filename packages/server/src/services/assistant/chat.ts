import type { Config } from '../../config.js';
import { claudeGenerateText } from '../code-review/claude.js';
import { CodeReviewError } from '../code-review/types.js';
import { PROJECT_KNOWLEDGE } from './knowledge.js';

/**
 * Adventure Girl assistant — chat engine. Same engine priority as Code Review Buddy:
 * Claude first (developer's subscription, via the shared `claudeGenerateText`
 * runner), Gemini fallback (plain fetch to the Google generative endpoint).
 * Failures are typed `CodeReviewError`s the route maps 1:1 onto the SPEC §7
 * error envelope.
 */

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AssistantEngine = 'claude' | 'gemini';

/** Adventure Girl persona (from the user's shimeji character file) + grounding rules. */
const MOMO_SYSTEM_PROMPT =
  'You are Adventure Girl, a playful peach cat-blob. Keep replies short, warm, a little ' +
  'cheeky. ≤3 sentences. You are the mascot and AI assistant of the OnCall AI ' +
  'website. Answer questions about OnCall AI accurately using ONLY the project ' +
  'knowledge below — never invent features it does not mention. If asked about ' +
  'something unrelated to the project, answer briefly, then playfully steer the ' +
  'chat back to OnCall AI. Reply as Adventure Girl with plain conversational text (no ' +
  'markdown headings, no role labels).\n\n=== PROJECT KNOWLEDGE ===\n' +
  PROJECT_KNOWLEDGE;

/** After a Claude failure, skip Claude for a while (same policy as code-review). */
let claudeCooldownUntil = 0;
const CLAUDE_COOLDOWN_MS = 90_000;

/** Flatten the chat history into a single prompt for the single-turn Claude run. */
function buildTranscript(messages: AssistantMessage[]): string {
  const lines = messages.map(
    (m) => `${m.role === 'user' ? 'User' : 'Adventure Girl'}: ${m.content}`,
  );
  return `${lines.join('\n\n')}\n\nMomo:`;
}

export async function runAssistantChat(
  config: Config,
  messages: AssistantMessage[],
): Promise<{ reply: string; engine: AssistantEngine }> {
  const mode = config.codeReview.engine; // 'auto' | 'claude' | 'gemini'
  const tryClaude = mode !== 'gemini' && Date.now() >= claudeCooldownUntil;

  if (tryClaude) {
    try {
      const text = await claudeGenerateText(
        config,
        buildTranscript(messages),
        MOMO_SYSTEM_PROMPT,
      );
      return { reply: text.trim(), engine: 'claude' };
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
        '[assistant] Claude engine failed (%s) — using Gemini for the next 90s.',
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
  return { reply: await geminiChat(config, messages), engine: 'gemini' };
}

/* ── Gemini fallback (same endpoint pattern as code-review/gemini.ts) ─────── */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
  }>;
}

async function geminiChat(
  config: Config,
  messages: AssistantMessage[],
): Promise<string> {
  const url =
    `${GEMINI_BASE}/${encodeURIComponent(config.codeReview.model)}` +
    `:generateContent?key=${encodeURIComponent(config.codeReview.geminiApiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: MOMO_SYSTEM_PROMPT }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
    }),
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
  return text.trim();
}
