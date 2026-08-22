/**
 * support-ai — LLM customer-support assistant (SPEC §12 AI plane).
 *
 *   POST /api/support/chat        { message, sessionId? } -> assistant reply
 *   POST /api/support/classify    { message }             -> intent + confidence
 *   GET  /api/support/faq          (?q=)                  -> retrieved FAQ answer
 *
 * LLM-inference shaped: `model` ("claude-haiku"), `reply`, `tokensIn`/`tokensOut`,
 * and `confidence`, with the highest latency of the AI plane (~300–700ms). ~1% of
 * chat calls return a 503 "model overloaded" so the service score is believable.
 */

import { Router } from 'express';
import { asyncRoute, delay, jitter, maybeFail, pick, score } from '../lib/sim.js';

export const supportRouter = Router();

const MODEL = 'claude-haiku';

const REPLIES = [
  'I can help with that. Your most recent order is on its way and should arrive within 2 business days.',
  'Happy to help! You can start a return from Orders → Return items; refunds post within 3–5 days.',
  'Thanks for reaching out. I’ve applied a one-time 10% courtesy credit to your account.',
  'It looks like that item is back in stock. Would you like me to add it to your cart?',
  'Sorry for the trouble. I’ve reset your session — please try signing in again.',
] as const;

const INTENTS = ['order_status', 'return_refund', 'payment_issue', 'product_question', 'account_help'] as const;

/** Rough token estimate from character length (~4 chars/token). */
function tokensOf(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

supportRouter.post(
  '/chat',
  asyncRoute(async (req, res) => {
    const latencyMs = jitter(480, 0.42); // ~280–680ms LLM latency
    await delay(latencyMs);
    const { message, sessionId } = (req.body ?? {}) as { message?: string; sessionId?: string };
    if (typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({
        error: { code: 'validation_error', message: 'message is required' },
      });
    }
    // ~1% model overloaded — a realistic transient LLM error.
    if (maybeFail(0.01)) {
      return res.status(503).json({
        error: { code: 'model_overloaded', message: 'the model is overloaded, please retry' },
      });
    }
    const reply = pick(REPLIES);
    return res.status(200).json({
      model: MODEL,
      sessionId: sessionId ?? `sess_${Math.random().toString(36).slice(2, 10)}`,
      reply,
      tokensIn: tokensOf(message),
      tokensOut: tokensOf(reply),
      confidence: score(0.7, 0.97),
      latencyMs,
    });
  }),
);

supportRouter.post(
  '/classify',
  asyncRoute(async (req, res) => {
    const latencyMs = jitter(320, 0.4); // ~190–450ms
    await delay(latencyMs);
    const { message } = (req.body ?? {}) as { message?: string };
    if (typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({
        error: { code: 'validation_error', message: 'message is required' },
      });
    }
    return res.status(200).json({
      model: MODEL,
      intent: pick(INTENTS),
      confidence: score(0.68, 0.98),
      tokensIn: tokensOf(message),
      latencyMs,
    });
  }),
);

supportRouter.get(
  '/faq',
  asyncRoute(async (req, res) => {
    const latencyMs = jitter(360, 0.42); // ~210–510ms retrieval + generation
    await delay(latencyMs);
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const answer = pick(REPLIES);
    return res.status(200).json({
      model: MODEL,
      q,
      answer,
      tokensOut: tokensOf(answer),
      confidence: score(0.6, 0.94),
      latencyMs,
    });
  }),
);
