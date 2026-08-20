import type { Config } from '../../config.js';
import { CodeReviewError } from './types.js';

/**
 * Code Review Buddy — Claude engine. Runs a single-turn, tool-less review
 * through the Claude Agent SDK using the developer's Claude Max subscription
 * (no API key) — the exact auth path the investigation agent already uses in
 * this process (`packages/agent/src/live.ts`). Returns the model's raw text;
 * the caller parses/normalizes it exactly like Gemini output.
 */

/**
 * Build a CLEAN environment for the spawned Claude CLI. When this server is
 * itself launched from inside a Claude Code session (dev convenience), the
 * parent session leaks `CLAUDE_CODE_*` / `CLAUDECODE` / `ANTHROPIC_BASE_URL`
 * vars that make the child CLI believe it is a nested session and report
 * "Not logged in". Strip them so the subprocess authenticates like a fresh
 * top-level CLI via the developer's subscription (~/.claude.json).
 */
function subscriptionEnv(config: Config): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('CLAUDE')) continue; // CLAUDECODE, CLAUDE_CODE_*, CLAUDE_*
    if (k === 'ANTHROPIC_BASE_URL' || k === 'AI_AGENT' || k === 'BAGGAGE') continue;
    env[k] = v;
  }
  env.USE_CLAUDE_SUBSCRIPTION = 'true';
  env.CLAUDE_CODE_USE_SUBSCRIPTION = 'true';
  // Headless auth: a long-lived token from `claude setup-token` (in .env)
  // outranks everything — it survives the CLAUDE* strip above by design.
  const oauth = config.codeReview.claudeOauthToken || process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (oauth && oauth.trim() !== '') {
    env.CLAUDE_CODE_OAUTH_TOKEN = oauth.trim();
  }
  const key = config.agent.anthropicApiKey;
  if (!key || key.trim() === '') {
    delete env.ANTHROPIC_API_KEY;
  }
  return env;
}

const REVIEW_SYSTEM_PROMPT =
  'You are a code review engine. Respond with ONLY the JSON object the user ' +
  'requests — no markdown, no code fences, no commentary before or after.';

/** Hard wall-clock bound for one review turn. */
const CLAUDE_TIMEOUT_MS = 180_000;

export async function claudeGenerateText(config: Config, prompt: string): Promise<string> {
  const env = subscriptionEnv(config);

  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CLAUDE_TIMEOUT_MS);

  let assistantText = '';
  let resultText = '';
  let sdkError: string | undefined;

  try {
    const stream = sdk.query({
      prompt,
      options: {
        model: config.codeReview.claudeModel,
        maxTurns: 1,
        systemPrompt: REVIEW_SYSTEM_PROMPT,
        allowedTools: [],
        permissionMode: 'dontAsk',
        settingSources: [],
        includePartialMessages: false,
        abortController: abort,
        env,
      } as unknown as Parameters<typeof sdk.query>[0]['options'],
    });

    for await (const message of stream) {
      const m = message as {
        type?: string;
        subtype?: string;
        result?: unknown;
        message?: { content?: Array<{ type?: string; text?: unknown }> };
      };
      if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
        for (const block of m.message.content) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            assistantText += block.text;
          }
        }
      } else if (m.type === 'result') {
        if (typeof m.result === 'string') resultText = m.result;
        if (m.subtype && m.subtype !== 'success') {
          sdkError = `Claude SDK ended with ${m.subtype}`;
        }
        break; // terminal frame
      }
    }
  } catch (err) {
    throw new CodeReviewError(
      502,
      'upstream_error',
      `The Claude engine failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = (resultText || assistantText).trim();
  if (sdkError && text === '') {
    throw new CodeReviewError(502, 'upstream_error', sdkError);
  }
  if (text === '') {
    throw new CodeReviewError(
      502,
      'upstream_error',
      'The Claude engine returned no text — is Claude Code signed in on this machine?',
    );
  }
  return text;
}
