import { useEffect, useRef, useState } from 'react';
import { Send, RotateCcw } from 'lucide-react';
import type { ChatMessage, EvidenceRef } from '@oncall/shared';
import { postChat } from '../api/incidents';
import { ApiRequestError } from '../api/client';
import { v, tint } from '../lib/tokens';
import { Icon } from './primitives/Icon';
import { IconButton } from './primitives/Button';

/**
 * ChatPanel (DESIGN_SPEC §8.7, FR-16) — `POST /incidents/:id/chat`. Assistant
 * bubbles left, user right; assistant answers render expandable evidence chips.
 * Composer: auto-grow textarea, Enter to send / Shift+Enter newline, disabled +
 * spinner while awaiting. Empty state = suggestion chips (prefill + send).
 * Fills a Drawer/sheet body — lays out its own scroll region + sticky composer.
 */

const SUGGESTIONS = [
  'Why this commit?',
  'Could this affect other services?',
  'Write the postmortem',
];

interface Msg extends ChatMessage {
  /** Local id for keys. */
  _id: number;
}

export function ChatPanel({ incidentId }: { incidentId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const autosize = (): void => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    // Cap at ~5 lines (§8.7).
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  };

  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed === '' || sending) return;
    lastSent.current = trimmed;
    setError(null);
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    const userMsg: Msg = { _id: (idRef.current += 1), role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    try {
      const res = await postChat(incidentId, trimmed);
      setMessages((prev) => [
        ...prev,
        { _id: (idRef.current += 1), ...res.message },
      ]);
    } catch (err) {
      const msg =
        err instanceof ApiRequestError ? err.message : 'Couldn’t reach the agent';
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Chat with the investigating agent"
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        {messages.length === 0 && !sending ? (
          <div className="flex h-full flex-col justify-center gap-3">
            <p className="text-center text-sm text-ink-2">
              Ask the agent about this incident — grounded in its evidence.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-pill border border-border-strong px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-3 hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble key={m._id} message={m} />
            ))}
            {sending ? <TypingIndicator /> : null}
          </ul>
        )}

        {error ? (
          <div
            className="mt-3 flex items-center justify-between gap-2 rounded-md p-2.5 text-sm text-ink"
            style={{ backgroundColor: tint('critical', 8) }}
          >
            <span>{error} · couldn’t reach the agent</span>
            <button
              type="button"
              onClick={() => lastSent.current && void send(lastSent.current)}
              className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
            >
              <Icon icon={RotateCcw} size={14} />
              Retry
            </button>
          </div>
        ) : null}
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-lg border border-border-strong bg-surface-2 p-1.5 focus-within:border-accent">
          <label className="sr-only" htmlFor="chat-input">
            Message the agent
          </label>
          <textarea
            id="chat-input"
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autosize();
            }}
            onKeyDown={onKeyDown}
            placeholder="Ask the agent…"
            className="max-h-[120px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-body text-ink placeholder:text-ink-muted-text focus:outline-none"
          />
          <IconButton
            aria-label="Send message"
            onClick={() => void send(input)}
            disabled={sending || input.trim() === ''}
            className="mb-0.5 h-9 w-9"
          >
            {sending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />
            ) : (
              <Icon icon={Send} size={18} />
            )}
          </IconButton>
        </div>
        <p className="mt-1 px-1 text-sm text-ink-muted-text">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Msg }) {
  const isUser = message.role === 'user';
  return (
    <li className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[85%] rounded-lg px-3 py-2 text-body text-ink"
        style={{
          backgroundColor: isUser ? tint('accent', 16) : v('surface-2'),
        }}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.evidence && message.evidence.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.evidence.map((e, i) => (
              <EvidenceChip key={i} evidence={e} />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function EvidenceChip({ evidence }: { evidence: EvidenceRef }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex max-w-[220px] items-center gap-1 rounded-sm bg-surface-3 px-1.5 py-0.5 text-mono-sm text-accent-text hover:underline"
        title={evidence.ref}
      >
        <span className="truncate">{evidence.tool ?? evidence.type}</span>
      </button>
      {open ? (
        <span className="mt-1 rounded-sm bg-surface-3 p-2 font-mono text-mono-sm text-ink-2">
          {evidence.ref}
        </span>
      ) : null}
    </span>
  );
}

function TypingIndicator() {
  return (
    <li className="flex justify-start" aria-label="Agent is typing">
      <div className="flex items-center gap-1 rounded-lg bg-surface-2 px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full animate-pulse-live"
            style={{ backgroundColor: v('ink-muted'), animationDelay: `${i * 200}ms` }}
          />
        ))}
      </div>
    </li>
  );
}
