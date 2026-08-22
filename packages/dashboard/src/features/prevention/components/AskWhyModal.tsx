import { useEffect, useRef, useState } from 'react';
import { Send, ShieldQuestion, RotateCcw, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { HypothesisChallengeResult, EvidenceRef } from '@oncall/shared';
import { challengeHypothesis } from '../../../api/prevention';
import { ApiRequestError } from '../../../api/client';
import { v, tint } from '../../../lib/tokens';
import { Icon } from '../../../components/primitives/Icon';
import { IconButton } from '../../../components/primitives/Button';
import { Meter } from '../../../components/primitives/Meter';
import { Drawer } from '../../../components/primitives/Drawer';
import { EngineBadge } from './EngineBadge';

/**
 * AskWhyModal (AI PREVENTION Phase 5, "Ask Why") — a challenge dialog over
 * `POST /incidents/:id/challenge`. The user proposes an alternative cause; the
 * agent re-weighs it against the incident evidence and returns a revised
 * hypothesis, confidence, whether it changed, and the grounding evidence. Turns
 * stack so a viewer can push back repeatedly. Lives in a Drawer (side on desktop,
 * bottom sheet otherwise), mirroring the incident chat + postmortem panels.
 */

const SUGGESTIONS = [
  'Could this be a database issue instead?',
  'Isn’t this just a downstream timeout?',
  'Why not a traffic spike?',
];

interface Turn {
  id: number;
  question: string;
  pending: boolean;
  result?: HypothesisChallengeResult;
  error?: string;
}

export function AskWhyModal({
  incidentId,
  open,
  onClose,
  priorHypothesis,
  priorConfidence,
  isDesktop,
}: {
  incidentId: string;
  open: boolean;
  onClose: () => void;
  priorHypothesis: string | null;
  priorConfidence: number | null;
  isDesktop: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const idRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  const send = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed === '' || sending) return;
    lastSent.current = trimmed;
    setInput('');
    const id = (idRef.current += 1);
    setTurns((prev) => [...prev, { id, question: trimmed, pending: true }]);
    setSending(true);
    try {
      const result = await challengeHypothesis(incidentId, trimmed);
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, pending: false, result } : t)));
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : 'Couldn’t reach the agent';
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, pending: false, error: msg } : t)));
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
    <Drawer
      open={open}
      onClose={onClose}
      title="Ask why"
      variant={isDesktop ? 'side' : 'sheet'}
    >
      <div className="flex h-full flex-col">
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Prior hypothesis on record */}
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <span className="text-label uppercase tracking-wide text-ink-2">
              Current hypothesis
            </span>
            <p className="mt-1 text-body text-ink">
              {priorHypothesis ?? 'No root cause on record yet.'}
            </p>
            {priorConfidence != null ? <Meter confidence={priorConfidence} className="mt-2" /> : null}
          </div>

          {turns.length === 0 ? (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-ink-2">
                Challenge the diagnosis — propose an alternative and the agent re-weighs it
                against the evidence.
              </p>
              <div className="flex flex-wrap gap-2">
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
            <ul className="mt-4 flex flex-col gap-4">
              {turns.map((t) => (
                <TurnView key={t.id} turn={t} onRetry={() => lastSent.current && void send(lastSent.current)} />
              ))}
            </ul>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2 rounded-lg border border-border-strong bg-surface-2 p-1.5 focus-within:border-accent">
            <label className="sr-only" htmlFor="askwhy-input">
              Challenge the hypothesis
            </label>
            <textarea
              id="askwhy-input"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Propose an alternative cause…"
              className="max-h-[120px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-body text-ink placeholder:text-ink-muted-text focus:outline-none"
            />
            <IconButton
              aria-label="Submit challenge"
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
    </Drawer>
  );
}

function TurnView({ turn, onRetry }: { turn: Turn; onRetry: () => void }) {
  return (
    <li className="flex flex-col gap-2">
      {/* The challenge (user) */}
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-lg px-3 py-2 text-body text-ink"
          style={{ backgroundColor: tint('accent', 16) }}
        >
          {turn.question}
        </div>
      </div>

      {/* The agent's re-diagnosis */}
      {turn.pending ? (
        <div className="flex items-center gap-2 text-sm text-ink-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />
          Re-weighing against the evidence…
        </div>
      ) : turn.error ? (
        <div
          className="flex items-center justify-between gap-2 rounded-md p-2.5 text-sm text-ink"
          style={{ backgroundColor: tint('critical', 8) }}
        >
          <span>{turn.error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
          >
            <Icon icon={RotateCcw} size={14} /> Retry
          </button>
        </div>
      ) : turn.result ? (
        <ResultCard result={turn.result} />
      ) : null}
    </li>
  );
}

function ResultCard({ result: r }: { result: HypothesisChallengeResult }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex h-5 items-center gap-1 rounded-pill px-2 text-label uppercase tracking-wide text-ink"
          style={{ backgroundColor: r.changed ? tint('serious', 16) : tint('ok', 16) }}
        >
          <Icon icon={r.changed ? ShieldQuestion : CheckCircle2} size={12} />
          {r.changed ? 'Hypothesis revised' : 'Hypothesis holds'}
        </span>
        <EngineBadge engine={r.engine} />
      </div>

      {/* Prior → revised confidence */}
      {r.priorConfidence != null ? (
        <div className="mt-2.5 flex items-center gap-2 text-sm text-ink-2">
          <span className="tabular-nums">{Math.round(r.priorConfidence * 100)}%</span>
          <Icon icon={ArrowRight} size={13} />
          <span className="min-w-0 flex-1">
            <Meter confidence={r.confidence} showLowChip={false} />
          </span>
        </div>
      ) : (
        <Meter confidence={r.confidence} className="mt-2.5" />
      )}

      <p className="mt-2.5 text-body-md text-ink">{r.hypothesis}</p>

      {r.reasoning ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{r.reasoning}</p>
      ) : null}

      {r.evidence.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {r.evidence.map((e, i) => (
            <EvidenceChip key={i} evidence={e} />
          ))}
        </div>
      ) : null}
    </div>
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
        className="inline-flex max-w-[220px] items-center gap-1 rounded-sm px-1.5 py-0.5 text-mono-sm text-accent-text hover:underline"
        style={{ backgroundColor: v('surface-3') }}
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
