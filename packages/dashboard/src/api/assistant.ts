import { apiFetch } from './client';

/**
 * Momo assistant client — `POST /api/v1/assistant/chat`. The server takes the
 * running transcript (1–20 messages, content 1–2000 chars) and answers as Momo,
 * reporting which engine produced the reply (claude first, gemini fallback).
 */

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantChatResponse {
  reply: string;
  engine: string;
}

export function sendAssistantChat(
  messages: AssistantMessage[],
  signal?: AbortSignal,
): Promise<AssistantChatResponse> {
  return apiFetch<AssistantChatResponse>('/assistant/chat', {
    method: 'POST',
    body: { messages },
    signal,
  });
}
