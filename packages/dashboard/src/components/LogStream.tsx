import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Pause, Play, Trash2, ArrowDown } from 'lucide-react';
import type { LogEvent, LogLevel } from '@oncall/shared';
import { getLogs } from '../api';
import { apiUrl } from '../api/client';
import { useEventStream } from '../sse/useEventStream';
import { useReportLive } from '../state/LiveContext';
import { useReducedMotion } from '../hooks/useMediaQuery';
import { levelStyle } from '../lib/status';
import { clockMs, absoluteTime } from '../lib/format';
import { v, tint } from '../lib/tokens';
import { Card, CardHeader } from './primitives/Card';
import { Icon } from './primitives/Icon';
import { Chip } from './primitives/Badge';
import { ConnectionStatus } from './primitives/ConnectionStatus';
import { CodeBlock } from './primitives/CodeBlock';
import { Skeleton } from './primitives/Skeleton';

/**
 * LogStream (DESIGN_SPEC §8.2) — terminal-style card, newest at bottom, tail-follow
 * autoscroll. Backfill `GET /logs` seeds history; SSE `GET /logs/stream` appends
 * live `log` frames. Level-filter chips, search, pause/resume, clear, and the
 * shared ConnectionStatus. Windowed render (buffer ≤500, DOM ≤200). All four states.
 */

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const BUFFER_MAX = 500;
const DOM_MAX = 200;
const BACKFILL_LIMIT = 100;

export function LogStream({
  service,
  height = 420,
}: {
  service: string | null;
  height?: number;
}) {
  const [buffer, setBuffer] = useState<LogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [levels, setLevels] = useState<Set<LogLevel>>(new Set(LEVELS));
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const [following, setFollowing] = useState(true);
  const [newCount, setNewCount] = useState(0);

  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef<Set<string>>(new Set());

  // ── Backfill (newest-first from API → oldest-first for bottom-append view) ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const controller = new AbortController();
    getLogs({ service: service ?? undefined, limit: BACKFILL_LIMIT }, controller.signal)
      .then((res) => {
        if (cancelled) return;
        const chrono = [...res.events].reverse();
        seenIds.current = new Set(chrono.map((e) => e.id));
        setBuffer(chrono);
        setFollowing(true);
        setNewCount(0);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [service]);

  // ── Live stream ─────────────────────────────────────────────────────────
  const streamUrl = useMemo(
    () => apiUrl('/logs/stream', service ? { service } : undefined),
    [service],
  );

  const onLog = useCallback((data: unknown) => {
    const ev = data as LogEvent;
    if (!ev || typeof ev.id !== 'string' || seenIds.current.has(ev.id)) return;
    seenIds.current.add(ev.id);
    setBuffer((prev) => {
      const next = prev.length >= BUFFER_MAX ? prev.slice(prev.length - BUFFER_MAX + 1) : prev;
      return [...next, ev];
    });
    setFollowing((f) => {
      if (!f) setNewCount((n) => n + 1);
      return f;
    });
  }, []);

  const { status, retry } = useEventStream(streamUrl, {
    events: useMemo(() => ({ log: onLog }), [onLog]),
  });
  useReportLive('logs', status);

  // ── Derived view (filter → DOM cap) ────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = buffer.filter(
      (e) =>
        levels.has(e.level) &&
        (q === '' ||
          e.message.toLowerCase().includes(q) ||
          (e.endpoint ?? '').toLowerCase().includes(q)),
    );
    return filtered.slice(-DOM_MAX);
  }, [buffer, levels, search]);

  // ── Autoscroll (tail-follow, unless paused or scrolled up) ──────────────
  useEffect(() => {
    if (!following || paused) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible, following, paused]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollowing(atBottom);
    if (atBottom) setNewCount(0);
  };

  const jumpToLatest = (): void => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    setFollowing(true);
    setNewCount(0);
  };

  const toggleLevel = (lvl: LogLevel): void => {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      // Never allow an all-off filter (would read as an empty stream).
      return next.size === 0 ? new Set(LEVELS) : next;
    });
  };

  const offline = status === 'closed' || status === 'reconnecting';

  return (
    <Card className="flex flex-col" padded={false}>
      <div className="border-b border-border p-4 pb-3">
        <CardHeader
          title="Logs"
          className="mb-3"
          right={<ConnectionStatus status={status} onRetry={retry} />}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Filter by level">
            {LEVELS.map((lvl) => {
              const st = levelStyle(lvl);
              const on = levels.has(lvl);
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => toggleLevel(lvl)}
                  aria-pressed={on}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-pill px-2.5 text-sm transition-colors duration-fast ${
                    on ? 'text-ink' : 'text-ink-muted-text'
                  }`}
                  style={on ? { backgroundColor: tint(st.token, 14) } : { backgroundColor: v('surface-3') }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: on ? v(st.token) : v('ink-muted') }}
                  />
                  {st.label}
                </button>
              );
            })}
          </div>

          <label className="relative ml-auto flex min-w-[140px] flex-1 items-center sm:max-w-[220px]">
            <span className="pointer-events-none absolute left-2 text-ink-muted-text">
              <Icon icon={Search} size={16} />
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search logs…"
              aria-label="Search logs"
              className="h-8 w-full rounded-md border border-border-strong bg-surface-2 pl-8 pr-2 text-body text-ink placeholder:text-ink-muted-text focus:border-accent"
            />
          </label>

          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            title={paused ? 'Resume autoscroll' : 'Pause autoscroll'}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-ink-2 hover:bg-surface-3 hover:text-ink"
          >
            <Icon icon={paused ? Play : Pause} size={16} />
            <span className="hidden sm:inline">{paused ? 'Resume' : 'Pause'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setBuffer([]);
              seenIds.current = new Set();
              setNewCount(0);
            }}
            title="Clear the log view"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-ink-2 hover:bg-surface-3 hover:text-ink"
          >
            <Icon icon={Trash2} size={16} />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      <div className="relative">
        {offline && (
          <div
            className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm text-ink-2"
            style={{ backgroundColor: tint('warn', 8) }}
          >
            <span>
              {status === 'reconnecting'
                ? 'Reconnecting to the live stream…'
                : 'Live stream offline — showing buffered logs.'}
            </span>
            <button type="button" onClick={retry} className="font-medium text-accent-text hover:underline">
              Retry
            </button>
          </div>
        )}
        {paused && (
          <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-pill bg-surface-3 px-2.5 py-0.5 text-sm text-ink-muted-text">
            Paused
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Live log stream"
          className="overflow-y-auto font-mono"
          style={{ height }}
        >
          {loading ? (
            <div className="flex flex-col gap-1 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-2">
              {buffer.length === 0
                ? 'No logs yet — waiting for events'
                : 'No logs match the current filter'}
            </div>
          ) : (
            visible.map((ev) => <LogRow key={ev.id} ev={ev} />)
          )}
        </div>

        {newCount > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-pill bg-accent px-3 py-1 text-sm font-medium text-white shadow-elev-2"
          >
            <Icon icon={ArrowDown} size={14} />
            {newCount} new
          </button>
        )}
      </div>
    </Card>
  );
}

function LogRow({ ev }: { ev: LogEvent }) {
  const [open, setOpen] = useState(false);
  const st = levelStyle(ev.level);
  const tinted = ev.level === 'error' || ev.level === 'warn';
  const hasDetail = Boolean(
    ev.stack || ev.endpoint || ev.method || ev.status != null || ev.latency_ms != null,
  );

  return (
    <div
      className="animate-enter-up border-b border-border last:border-b-0"
      style={{
        borderLeft: `2px solid ${v(st.token)}`,
        backgroundColor: tinted ? tint(st.token, 8) : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1 text-left text-mono-sm hover:bg-surface-3"
        style={{ cursor: hasDetail ? 'pointer' : 'default', minHeight: 24 }}
        aria-expanded={hasDetail ? open : undefined}
      >
        <span className="tabular shrink-0 text-ink-muted-text" title={absoluteTime(ev.timestamp)}>
          {clockMs(ev.timestamp)}
        </span>
        <span
          className="w-12 shrink-0 font-medium uppercase"
          // BUG-011: label text in an ink token, never the raw status hue (§11 —
          // --warn is illegible on light). The level colour is carried by the 2px
          // left row border; ink-family levels (info/debug) keep their muted token.
          style={{ color: st.token.startsWith('ink') ? v(st.token) : v('ink') }}
        >
          {st.label}
        </span>
        <Chip className="shrink-0">{ev.service}</Chip>
        <span className="min-w-0 flex-1 truncate text-ink">{ev.message}</span>
      </button>

      {open && hasDetail && (
        <div className="flex flex-col gap-2 px-3 pb-2.5 pl-6">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
            {ev.method && ev.endpoint && (
              <span className="tabular">
                <span className="text-ink-muted-text">req </span>
                {ev.method} {ev.endpoint}
              </span>
            )}
            {ev.status != null && (
              <span className="tabular">
                <span className="text-ink-muted-text">status </span>
                {ev.status}
              </span>
            )}
            {ev.latency_ms != null && (
              <span className="tabular">
                <span className="text-ink-muted-text">latency </span>
                {ev.latency_ms}ms
              </span>
            )}
          </div>
          {ev.stack && <CodeBlock code={ev.stack} maxHeight={200} />}
        </div>
      )}
    </div>
  );
}
