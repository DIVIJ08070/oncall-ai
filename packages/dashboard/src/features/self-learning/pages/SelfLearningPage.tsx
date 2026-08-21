import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Brain,
  GitMerge,
  GitPullRequestClosed,
  Layers,
  MessageSquare,
  SearchCode,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { NeuralCore } from '../components/NeuralCore';
import { getRepoLearnings, rateLearning } from '../../../api/learnings';
import type { Learning, LearningLevel, LearningSource } from '../../../api/learnings';
import { usePolling } from '../../../hooks/usePolling';
import { Card } from '../../../components/primitives/Card';
import { StatTile, SectionHeader } from '../../../components/primitives/StatTile';
import { Chip } from '../../../components/primitives/Badge';
import { Drawer } from '../../../components/primitives/Drawer';
import { EmptyState } from '../../../components/primitives/EmptyState';
import { Button, IconButton } from '../../../components/primitives/Button';
import { Icon } from '../../../components/primitives/Icon';
import { Entrance, StaggerGroup, StaggerItem } from '../../../components/motion/primitives';
import { HudCorners, MonoTag } from '../../../components/atmosphere';
import { absoluteTime, pct, relativeTime } from '../../../lib/format';
import { tint, v } from '../../../lib/tokens';

/**
 * SelfLearningPage (`/learning`). The per-repo learning memory: a three.js
 * NeuralCore hero (built separately against the shared contract) surrounded by
 * a deliberately restrained DOM — level badge + progress, stat tiles, an
 * accuracy-growth sparkline, a recent-learnings feed with 👍/👎 rating, and the
 * six-level evolution ladder. Clicking a neuron (or a feed row) opens the
 * detail drawer. The repo under inspection persists in localStorage.
 */

const REPO_STORAGE_KEY = 'oncall.selfLearning.repo';
const DEFAULT_REPO = 'DIVIJ08070/oncall-ai-victim';
const POLL_MS = 15_000;
const NEWBORN_MESSAGE =
  'The AI has not learned this repo yet — feedback from PRs will grow it.';

/** Display metadata per learning source (icon + human label). */
const SOURCE_META: Record<LearningSource, { icon: LucideIcon; label: string }> = {
  rating: { icon: MessageSquare, label: 'explicit rating' },
  merge: { icon: GitMerge, label: 'PR merged' },
  closed: { icon: GitPullRequestClosed, label: 'PR closed' },
  review: { icon: SearchCode, label: 'code review' },
};

/** The evolution ladder — thresholds mirror the server's level table. */
const LEVELS: Array<{ name: string; at: number; unlocks: string }> = [
  { name: 'OBSERVER', at: 0, unlocks: 'A newborn core — a dim spark waiting for its first signal.' },
  { name: 'APPRENTICE', at: 5, unlocks: 'First synapses connect; neurons begin to fire.' },
  { name: 'RESIDENT', at: 15, unlocks: 'Clusters form around recurring error classes.' },
  { name: 'SPECIALIST', at: 30, unlocks: 'Dense pathways light up along proven fixes.' },
  { name: 'VETERAN', at: 60, unlocks: 'Constellations pulse — the core anticipates failures.' },
  { name: 'ORACLE', at: 100, unlocks: 'A living mind: the whole cortex glows with memory.' },
];

const OBSERVER_LEVEL: LearningLevel = {
  index: 0,
  name: 'OBSERVER',
  total: 0,
  nextAt: LEVELS[1].at,
  progress: 0,
};

function loadStoredRepo(): string {
  try {
    return window.localStorage.getItem(REPO_STORAGE_KEY)?.trim() || DEFAULT_REPO;
  } catch {
    return DEFAULT_REPO;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function SelfLearningPage() {
  const [repo, setRepo] = useState<string>(() => loadStoredRepo());
  const [draft, setDraft] = useState(repo);

  const commitRepo = (): void => {
    const next = draft.trim();
    if (!next || next === repo) {
      setDraft(repo);
      return;
    }
    try {
      window.localStorage.setItem(REPO_STORAGE_KEY, next);
    } catch {
      /* persistence is best-effort */
    }
    setRepo(next);
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    commitRepo();
  };

  return (
    <Entrance className="flex flex-col gap-6">
      {/* Title row + repo picker */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-playfair text-h1 italic text-ink">Self-Learning</h1>
        <form className="flex items-center gap-2" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="learning-repo">
            Repository (owner/name)
          </label>
          <input
            id="learning-repo"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRepo}
            placeholder="owner/repo"
            spellCheck={false}
            autoComplete="off"
            className="h-9 w-64 max-w-full rounded-md border border-border-strong bg-surface-2 px-3 font-mono text-mono text-ink placeholder:text-ink-muted-text focus:border-accent"
          />
        </form>
      </div>

      {/* Keyed by repo so data/selection state never bleeds across repos. */}
      <RepoBrain key={repo} repo={repo} />
    </Entrance>
  );
}

/* ── Per-repo content (data + hero + panels) ─────────────────────────────── */

function RepoBrain({ repo }: { repo: string }) {
  const [selected, setSelected] = useState<Learning | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data, error, loading, refetch } = usePolling(
    (signal) => getRepoLearnings(repo, signal),
    [repo],
    { intervalMs: POLL_MS },
  );

  const learnings = useMemo(() => data?.learnings ?? [], [data]);
  const stats = data?.stats ?? { total: 0, positive: 0, negative: 0, bySource: {} };
  const level = data?.level ?? OBSERVER_LEVEL;
  const newborn = !loading && learnings.length === 0;

  const onRate = async (l: Learning, rating: -1 | 1): Promise<void> => {
    setPendingId(l.id);
    try {
      const res = await rateLearning({
        repo,
        prNumber: l.prNumber,
        errorClass: l.errorClass,
        rootCause: l.rootCause,
        fixApproach: l.fixApproach,
        rating,
      });
      // Keep the open drawer in sync with the confirmed/updated learning.
      setSelected((cur) => (cur && cur.id === l.id ? res.learning : cur));
      refetch();
    } catch {
      /* leave the feed usable; the next poll reconciles */
    } finally {
      setPendingId(null);
    }
  };

  const topErrorClass = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of learnings) {
      counts.set(l.errorClass, (counts.get(l.errorClass) ?? 0) + l.confirmations);
    }
    let top: string | null = null;
    let max = 0;
    for (const [name, count] of counts) {
      if (count > max) {
        max = count;
        top = name;
      }
    }
    return top;
  }, [learnings]);

  return (
    <>
      {/* Level band */}
      <Card interactive={false} className="relative overflow-hidden">
        <HudCorners size={12} inset={8} className="opacity-40" />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-accent"
              style={{ backgroundColor: tint('accent', 14) }}
            >
              <Icon icon={Brain} size={20} />
            </span>
            <div>
              <MonoTag dot={false}>Neural level</MonoTag>
              <div className="tabular text-h2 font-semibold text-ink">
                LEVEL {level.index} · {level.name}
              </div>
            </div>
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="mb-1.5 flex items-center justify-between text-sm text-ink-2">
              <span className="tabular">{level.total} learnings</span>
              <span className="tabular">
                {level.nextAt != null ? `next level at ${level.nextAt}` : 'max level'}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={clamp01(level.progress)}
              aria-valuemin={0}
              aria-valuemax={1}
              aria-label="Progress to next level"
              className="h-1.5 overflow-hidden rounded-pill bg-surface-3"
            >
              <div
                className="h-full rounded-pill bg-accent transition-[width] duration-slow"
                style={{
                  width: `${Math.round((level.nextAt == null ? 1 : clamp01(level.progress)) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Hero — the brain is the show; DOM around it stays quiet. */}
      <div className="relative overflow-hidden rounded-lg border border-border bg-surface/60 shadow-elev-1">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(60% 60% at 50% 45%, ${tint('accent', 10)}, transparent 75%)`,
          }}
        />
        <HudCorners size={14} inset={10} className="opacity-50" />
        <div className="pointer-events-none absolute left-4 top-3 z-10">
          <MonoTag>NEURAL CORE · {repo}</MonoTag>
        </div>
        <div className="pointer-events-none absolute right-4 top-3 z-10">
          <MonoTag dot={false}>{loading ? 'SYNCING' : `${stats.total} MEMORIES`}</MonoTag>
        </div>
        <NeuralCore
          learnings={learnings}
          level={level.index}
          onSelect={setSelected}
          className="h-[380px] w-full sm:h-[460px] lg:h-[520px]"
        />
        {newborn && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
            <p className="max-w-sm rounded-md border border-border bg-surface/80 px-4 py-2 text-center text-sm text-ink-2 backdrop-blur-sm">
              {NEWBORN_MESSAGE}
            </p>
          </div>
        )}
      </div>

      {/* Stat tiles */}
      <StaggerGroup className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StaggerItem>
          <StatTile
            label="Total learnings"
            value={stats.total}
            icon={Brain}
            caption={`${Object.keys(stats.bySource).length || 'no'} feedback sources`}
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="Confirmed"
            value={stats.positive}
            icon={ThumbsUp}
            accent="var(--ok)"
            caption="positive signals"
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="Corrected"
            value={stats.negative}
            icon={ThumbsDown}
            accent="var(--critical)"
            caption="negative signals"
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="Top error class"
            value={
              <span className="block truncate font-mono text-h2 leading-7">
                {topErrorClass ?? '—'}
              </span>
            }
            icon={Layers}
            caption="most-confirmed pattern"
          />
        </StaggerItem>
      </StaggerGroup>

      <SectionHeader title="Memory & evolution" icon={Sparkles} className="pt-1" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <GrowthCard learnings={learnings} />
          <FeedCard
            learnings={learnings}
            loading={loading}
            error={error}
            pendingId={pendingId}
            onSelect={setSelected}
            onRate={onRate}
            onRetry={refetch}
          />
        </div>
        <EvolutionCard levelIndex={level.index} total={stats.total} />
      </div>

      {/* Selected-neuron detail panel */}
      <Drawer
        open={selected != null}
        onClose={() => setSelected(null)}
        title={selected?.errorClass ?? 'Learning'}
      >
        {selected && (
          <LearningDetail
            learning={selected}
            pending={pendingId === selected.id}
            onRate={onRate}
          />
        )}
      </Drawer>
    </>
  );
}

/* ── Accuracy growth sparkline ───────────────────────────────────────────── */

function GrowthCard({ learnings }: { learnings: Learning[] }) {
  // Cumulative share of positively-rated learnings, in createdAt order.
  const growth = useMemo(() => {
    const ordered = [...learnings].sort((a, b) => a.createdAt - b.createdAt);
    let positive = 0;
    return ordered.map((l, i) => {
      if (l.rating > 0) positive += 1;
      return { ts: l.createdAt, share: positive / (i + 1) };
    });
  }, [learnings]);

  const current = growth.length > 0 ? growth[growth.length - 1].share : null;

  return (
    <Card interactive={false}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <MonoTag dot={false}>Accuracy growth</MonoTag>
        <span className="tabular text-sm text-ink-2">
          {current != null ? `${pct(current)} positive` : '—'}
        </span>
      </div>
      <div
        style={{ height: 120 }}
        role="img"
        aria-label="Cumulative share of positively-rated learnings over time"
      >
        {growth.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={growth} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="learn-growth" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} hide />
              <YAxis domain={[0, 1]} hide />
              <Tooltip content={<GrowthTooltip />} cursor={{ stroke: 'var(--axis)' }} />
              <Area
                type="monotone"
                dataKey="share"
                stroke="var(--accent)"
                strokeWidth={2}
                fill="url(#learn-growth)"
                isAnimationActive={false}
                activeDot={{ r: 3, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--accent)' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted-text">
            Needs at least two learnings to draw a trend
          </div>
        )}
      </div>
    </Card>
  );
}

function GrowthTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm shadow-elev-2">
      <div className="tabular text-ink-muted-text">{label != null ? absoluteTime(label) : ''}</div>
      <div className="tabular text-ink">{pct(payload[0].value)} positive</div>
    </div>
  );
}

/* ── Recent learnings feed ───────────────────────────────────────────────── */

function FeedCard({
  learnings,
  loading,
  error,
  pendingId,
  onSelect,
  onRate,
  onRetry,
}: {
  learnings: Learning[];
  loading: boolean;
  error: Error | null;
  pendingId: string | null;
  onSelect: (l: Learning) => void;
  onRate: (l: Learning, rating: -1 | 1) => Promise<void>;
  onRetry: () => void;
}) {
  const recent = useMemo(
    () => [...learnings].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8),
    [learnings],
  );

  return (
    <Card interactive={false} className="flex min-w-0 flex-col">
      <div className="mb-2 flex items-center justify-between gap-3">
        <MonoTag dot={false}>Recent learnings</MonoTag>
        {loading && <span className="text-sm text-ink-muted-text">syncing…</span>}
      </div>

      {error && recent.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="Couldn't reach the learning memory"
          subtitle={error.message}
          action={
            <Button variant="ghost" onClick={onRetry}>
              Retry
            </Button>
          }
        />
      ) : recent.length === 0 && !loading ? (
        <EmptyState icon={Brain} title="A newborn brain" subtitle={NEWBORN_MESSAGE} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {recent.map((l) => {
            const meta = SOURCE_META[l.source] ?? SOURCE_META.rating;
            const pending = pendingId === l.id;
            return (
              <li key={l.id} className="flex items-start gap-3 py-3 first:pt-1 last:pb-1">
                <span className="mt-1 shrink-0 text-ink-muted-text">
                  <Icon icon={meta.icon} size={16} label={meta.label} />
                </span>
                <button
                  type="button"
                  onClick={() => onSelect(l)}
                  className="min-w-0 flex-1 rounded-md text-left transition-colors duration-fast hover:bg-surface-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip className="font-mono">{l.errorClass}</Chip>
                    <span
                      className="tabular text-sm text-ink-muted-text"
                      title={`confirmed ${l.confirmations} time${l.confirmations === 1 ? '' : 's'}`}
                    >
                      ×{l.confirmations}
                    </span>
                    <span
                      className="text-sm text-ink-muted-text"
                      title={absoluteTime(l.createdAt)}
                    >
                      {relativeTime(l.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-body text-ink-2">{l.rootCause}</p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    aria-label={`Confirm learning about ${l.errorClass}`}
                    disabled={pending}
                    onClick={() => void onRate(l, 1)}
                  >
                    <span style={{ color: l.rating > 0 ? v('ok') : undefined }}>
                      <Icon icon={ThumbsUp} size={16} />
                    </span>
                  </IconButton>
                  <IconButton
                    aria-label={`Correct learning about ${l.errorClass}`}
                    disabled={pending}
                    onClick={() => void onRate(l, -1)}
                  >
                    <span style={{ color: l.rating < 0 ? v('critical') : undefined }}>
                      <Icon icon={ThumbsDown} size={16} />
                    </span>
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ── Evolution ladder ────────────────────────────────────────────────────── */

function EvolutionCard({ levelIndex, total }: { levelIndex: number; total: number }) {
  return (
    <Card interactive={false} className="relative h-fit overflow-hidden">
      <HudCorners size={10} inset={6} className="opacity-30" />
      <div className="mb-3">
        <MonoTag dot={false}>Evolution</MonoTag>
      </div>
      <ol className="flex flex-col gap-1.5">
        {LEVELS.map((lv, i) => {
          const current = i === levelIndex;
          const reached = total >= lv.at;
          return (
            <li
              key={lv.name}
              aria-current={current ? 'step' : undefined}
              className={`relative flex items-start gap-3 rounded-lg border p-3 ${
                current ? 'border-border-strong bg-surface-2' : 'border-transparent'
              }`}
            >
              {current && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-r bg-accent"
                  style={{ width: 2 }}
                />
              )}
              <span
                className="tabular mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-label"
                style={{
                  backgroundColor: reached ? tint('accent', 18) : 'var(--surface-3)',
                  color: reached ? 'var(--accent-text)' : 'var(--ink-muted-text)',
                }}
              >
                {i}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`font-mono text-sm tracking-[0.18em] ${
                      reached ? 'text-ink' : 'text-ink-muted-text'
                    }`}
                  >
                    {lv.name}
                  </span>
                  <span className="tabular text-label text-ink-muted-text">{lv.at}+</span>
                  {current && (
                    <span
                      className="rounded-pill px-1.5 py-0.5 text-label uppercase text-accent-text"
                      style={{ backgroundColor: tint('accent', 14) }}
                    >
                      current
                    </span>
                  )}
                </div>
                <p className={`mt-0.5 text-sm ${reached ? 'text-ink-2' : 'text-ink-muted-text'}`}>
                  {lv.unlocks}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ── Selected-neuron detail (drawer body) ────────────────────────────────── */

function LearningDetail({
  learning,
  pending,
  onRate,
}: {
  learning: Learning;
  pending: boolean;
  onRate: (l: Learning, rating: -1 | 1) => Promise<void>;
}) {
  const meta = SOURCE_META[learning.source] ?? SOURCE_META.rating;
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip className="font-mono">{learning.errorClass}</Chip>
        <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
          <Icon icon={meta.icon} size={14} />
          {meta.label}
        </span>
        {learning.prNumber != null && <Chip>PR #{learning.prNumber}</Chip>}
      </div>

      <DetailField label="Root cause">{learning.rootCause}</DetailField>
      {learning.fixApproach && (
        <DetailField label="Fix approach">{learning.fixApproach}</DetailField>
      )}
      {learning.note && <DetailField label="Note">{learning.note}</DetailField>}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-ink-muted-text">Confirmations</dt>
          <dd className="tabular mt-0.5 text-ink">×{learning.confirmations}</dd>
        </div>
        <div>
          <dt className="text-ink-muted-text">Signal</dt>
          <dd className="mt-0.5 text-ink">
            {learning.rating > 0 ? 'confirmed' : learning.rating < 0 ? 'corrected' : 'neutral'}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-ink-muted-text">Learned</dt>
          <dd className="mt-0.5 text-ink" title={absoluteTime(learning.createdAt)}>
            {relativeTime(learning.createdAt)}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center gap-2 border-t border-border pt-4">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => void onRate(learning, 1)}
          leadingIcon={<Icon icon={ThumbsUp} size={16} />}
        >
          Confirm
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => void onRate(learning, -1)}
          leadingIcon={<Icon icon={ThumbsDown} size={16} />}
        >
          Correct
        </Button>
      </div>
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <MonoTag dot={false}>{label}</MonoTag>
      <p className="mt-1 whitespace-pre-wrap text-body text-ink">{children}</p>
    </div>
  );
}
