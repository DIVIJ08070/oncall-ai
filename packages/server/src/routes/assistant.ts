import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { sendError } from '../http/errors.js';
import { runAssistantChat } from '../services/assistant/chat.js';
import { CodeReviewError } from '../services/code-review/types.js';

/**
 * Momo assistant — site mascot chat endpoint:
 *
 *   POST /api/v1/assistant/chat  { messages: [{ role, content }, ...] }
 *     → 200 { reply: string, engine: 'claude' | 'gemini' }
 *
 * Same openness as the demo/code-review routes (no session auth). Engine
 * failures arrive as typed `CodeReviewError`s (the shared upstream-error type)
 * and map 1:1 onto the SPEC §7 error envelope.
 */

const AssistantMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
});

const ChatRequestSchema = z.object({
  messages: z.array(AssistantMessageSchema).min(1).max(20),
});

/** momo-bot bundle contract (the roaming mascot's own chat client). */
const MomoPageSchema = z
  .object({
    url: z.string().max(500).optional(),
    title: z.string().max(300).optional(),
    context: z.string().max(4000).optional(),
  })
  .optional();
const MomoChatSchema = z.object({
  messages: z.array(AssistantMessageSchema).min(1).max(20),
  page: MomoPageSchema,
});

export function registerAssistantRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  const { config } = ctx;

  app.post('/api/v1/assistant/chat', async (req, reply) => {
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid chat request', {
        issues: parsed.error.issues,
      });
    }
    try {
      const result = await runAssistantChat(config, parsed.data.messages);
      return await reply.code(200).send(result);
    } catch (err) {
      if (err instanceof CodeReviewError) {
        return sendError(reply, err.status, err.code, err.message);
      }
      throw err; // global handler → 500 internal
    }
  });

  // The momo-bot mascot bundle POSTs here: { messages, page? } → { ok, reply }.
  // On hard engine failure it expects a 503 so it can degrade gracefully
  // (mascot keeps roaming, chat hides).
  app.post('/api/chat', async (req, reply) => {
    const parsed = MomoChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_error', 'Invalid chat request', {
        issues: parsed.error.issues,
      });
    }
    try {
      const msgs = [...parsed.data.messages];
      const page = parsed.data.page;
      if (page && (page.context || page.title)) {
        const note = `\n\n[Visitor is on: ${page.title ?? ''} ${page.url ?? ''}]\n${(page.context ?? '').slice(0, 1500)}`;
        const last = msgs[msgs.length - 1];
        if (last.role === 'user') {
          msgs[msgs.length - 1] = {
            ...last,
            content: `${last.content}${note}`.slice(0, 3500),
          };
        }
      }
      const result = await runAssistantChat(config, msgs);
      return reply.send({ ok: true, reply: result.reply });
    } catch {
      return reply.code(503).send({ ok: false, configured: false });
    }
  });
}
