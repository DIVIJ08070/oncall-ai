import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import {
  Brain,
  Gauge,
  GitMerge,
  GitPullRequestClosed,
  MessageSquare,
  SearchCode,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { NeuralCore } from '../components/NeuralCore';
import { KnowledgeMap } from '../components/KnowledgeMap';
import { StatSparkCard } from '../components/StatSparkCard';
import { EvolutionLadder } from '../components/EvolutionLadder';
import { getRepoLearnings, rateLearning } from '../../../api/learnings';
import type { Learning, LearningLevel, LearningSource } from '../../../api/learnings';
import { usePolling } from '../../../hooks/usePolling';
import { GlassCard, MONO } from '../../../components/shell/UnifiedChrome';
import { Chip } from '../../../components/primitives/Badge';
import { Drawer } from '../../../components/primitives/Drawer';
import { EmptyState } from '../../../components/primitives/EmptyState';
import { Button, IconButton } from '../../../components/primitives/Button';
import { Icon } from '../../../components/primitives/Icon';
import { Entrance, StaggerGroup, StaggerItem } from '../../../components/motion/primitives';
import { absoluteTime, relativeTime } from '../../../lib/format';

/**
 * SelfLearningPage (`/learning`) — the AI-brain command center. Desktop is a
 * three-column grid: sparkline stat rail (left), the interactive NeuralCore
 * brain with floating mastery tags + an "analyzing" bar (center), and the
 * evolution ladder / growth / accuracy / learned-today stack (right). Below:
 * the learning timeline (with 👍/👎 rating) beside the KnowledgeMap. Columns
 * stack on mobile (stats become a 2×2 grid). All numbers derive from the real
 * per-repo learnings API; the repo under inspection persists in localStorage.
 */

const REPO_STORAGE_KEY = 'oncall.selfLearning.repo';
const DEFAULT_REPO = 'DIVIJ08070/oncall-ai-victim';
const POLL_MS = 15_000;
const NEWBORN_MESSAGE =
  'The AI has not learned this repo yet — feedback from PRs will grow it.';

const ORANGE = '#F16524';
const ORANGE_HI = '#FF8233';
const GREEN = '#52D273';
const RED = '#FF3B30';
const WEEK_MS = 7 * 86_400_000;

/** Page-scoped keyframes (tag bob + indeterminate analyzing bar). */
const PAGE_CSS = `
@keyframes sl-bob { from { transform: translateY(-5px); } to { transform: translateY(5px); } }
@keyframes sl-scan { 0% { transform: translateX(-110%); } 100% { transform: translateX(340%); } }
@media (prefers-reduced-motion: reduce) { [data-sl-anim] { animation: none !important; } }
`;

/** Display metadata per learning source for the detail drawer. */
const SOURCE_META: Record<LearningSource, { icon: LucideIcon; label: string }> = {
  rating: { icon: MessageSquare, label: 'explicit rating' },
  merge: { icon: GitMerge, label: 'PR merged' },
  closed: { icon: GitPullRequestClosed, label: 'PR closed' },
  review: { icon: SearchCode, label: 'code review' },
};

/** Timeline chip per learning source (label + tint). */
const SOURCE_CHIP: Record<LearningSource, { label: string; cls: string }> = {
  rating: { label: 'Feedback', cls: 'border-[#F16524]/30 bg-[#F16524]/15 text-[#FF8233]' },
  merge: { label: 'Fix Merged', cls: 'border-[#52D273]/30 bg-[#52D273]/10 text-[#52D273]' },
  review: { label: 'Review Finding', cls: 'border-[#8B5CF6]/30 bg-[#8B5CF6]/15 text-[#A78BFA]' },
  closed: { label: 'Corrected', cls: 'border-[#FF3B30]/30 bg-[#FF3B30]/10 text-[#FF6B61]' },
};

const OBSERVER_LEVEL: LearningLevel = {
  index: 0,
  name: 'OBSERVER',
  total: 0,
  nextAt: 5,
  progress: 0,
};

/* ── data helpers ────────────────────────────────────────────────────────── */

function loadStoredRepo(): string {
  try {
    return window.localStorage.getItem(REPO_STORAGE_KEY)?.trim() || DEFAULT_REPO;
  } catch {
    return DEFAULT_REPO;
  }
}

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Cumulative weighted count bucketed over the createdAt span (flat when empty). */
function cumulativeSeries(
  items: Learning[],
  weight: (l: Learning) => number,
  buckets = 14,
): number[] {
  const out = new Array<number>(buckets).fill(0);
  if (items.length === 0) return out;
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
  const min = sorted[0]?.createdAt ?? 0;
  const max = sorted[sorted.length - 1]?.createdAt ?? min;
  const span = Math.max(1, max - min);
  let acc = 0;
  let k = 0;
  for (let b = 0; b < buckets; b++) {
    const edge = min + (span * (b + 1)) / buckets;
    for (;;) {
      const item = sorted[k];
      if (!item || item.createdAt > edge) break;
      acc += weight(item);
      k++;
    }
    out[b] = acc;
  }
  return out;
}

/** Cumulative positive/(positive+negative) share bucketed over time. */
function scoreSeries(items: Learning[], buckets = 14): number[] {
  const out = new Array<number>(buckets).fill(0);
  if (items.length === 0) return out;
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
  const min = sorted[0]?.createdAt ?? 0;
  const max = sorted[sorted.length - 1]?.createdAt ?? min;
  const span = Math.max(1, max - min);
  let pos = 0;
  let neg = 0;
  let k = 0;
  for (let b = 0; b < buckets; b++) {
    const edge = min + (span * (b + 1)) / buckets;
    for (;;) {
      const item = sorted[k];
      if (!item || item.createdAt > edge) break;
      if (item.rating > 0) pos++;
      else if (item.rating < 0) neg++;
      k++;
    }
    out[b] = pos + neg > 0 ? pos / (pos + neg) : 0;
  }
  return out;
}

/** Cumulative learnings total at the end of each of the last 7 days. */
function growthByDay(items: Learning[]): Array<{ label: string; total: number }> {
  const out: Array<{ label: string; total: number }> = [];
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  for (let i = 6; i >= 0; i--) {
    const dayEnd = end.getTime() - i * 86_400_000;
    out.push({
      label: new Date(dayEnd).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2),
      total: items.filter((l) => l.createdAt <= dayEnd).length,
    });
  }
  return out;
}

/* ── page shell (repo picker persists; content keyed by repo) ────────────── */

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
    <Entrance className="flex flex-col gap-5">
      <style>{PAGE_CSS}</style>

      {/* Header — title, subtitle, live badge; repo picker top-right */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold tracking-tight text-[#F5F5F2] sm:text-[30px]">
            Self Learning
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-white/50">
            The AI is analyzing your incidents and reviews, learning patterns and improving
            accuracy.
          </p>
          <div className="mt-3 inline-flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
            <span className="h-2 w-2 shrink-0 animate-pulse-live rounded-full bg-[#52D273]" />
            <span
              className="text-[10px] uppercase tracking-[0.18em] text-white/60"
              style={{ fontFamily: MONO }}
            >
              AI Learning in Progress · real-time evolution active
            </span>
          </div>
        </div>
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
            className="h-9 w-64 max-w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs text-[#F5F5F2] placeholder:text-white/30 focus:border-[#F16524]/60 focus:outline-none"
            style={{ fontFamily: MONO }}
          />
        </form>
      </div>

      {/* Keyed by repo so data/selection state never bleeds across repos. */}
      <RepoBrain key={repo} repo={repo} />
    </Entrance>
  );
}

/* ── per-repo content ────────────────────────────────────────────────────── */

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

  /* — derived numbers (all from real data) — */
  const sortedDesc = useMemo(
    () => [...learnings].sort((a, b) => b.createdAt - a.createdAt),
    [learnings],
  );
  const latest = sortedDesc[0] ?? null;

  const confirmationsTotal = useMemo(
    () => learnings.reduce((s, l) => s + l.confirmations, 0),
    [learnings],
  );
  const signals = stats.positive + stats.negative;
  const score = signals > 0 ? stats.positive / signals : null;

  const weekAgo = Date.now() - WEEK_MS;
  const weekStats = useMemo(() => {
    const recent = learnings.filter((l) => l.createdAt >= weekAgo);
    return {
      patterns: recent.length,
      confirmations: recent.reduce((s, l) => s + l.confirmations, 0),
      corrections: recent.filter((l) => l.rating < 0).length,
    };
  }, [learnings, weekAgo]);

  const scoreDelta = useMemo((): { text: string; color?: string } => {
    if (score == null) return { text: 'no rated signals yet' };
    const oldPos = learnings.filter((l) => l.createdAt < weekAgo && l.rating > 0).length;
    const oldNeg = learnings.filter((l) => l.createdAt < weekAgo && l.rating < 0).length;
    if (oldPos + oldNeg === 0) return { text: 'baseline forming', color: GREEN };
    const d = Math.round((score - oldPos / (oldPos + oldNeg)) * 100);
    if (d === 0) return { text: 'steady this week' };
    return {
      text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pts this week`,
      color: d > 0 ? GREEN : RED,
    };
  }, [learnings, score, weekAgo]);

  const seriesScore = useMemo(() => scoreSeries(learnings), [learnings]);
  const seriesTotal = useMemo(() => cumulativeSeries(learnings, () => 1), [learnings]);
  const seriesConf = useMemo(
    () => cumulativeSeries(learnings, (l) => l.confirmations),
    [learnings],
  );
  const seriesNeg = useMemo(
    () => cumulativeSeries(learnings, (l) => (l.rating < 0 ? 1 : 0)),
    [learnings],
  );

  /** Per-error-class mastery for the floating tags around the brain. */
  const masteryTags = useMemo(() => {
    const agg = new Map<string, number>();
    for (const l of learnings) {
      agg.set(l.errorClass, (agg.get(l.errorClass) ?? 0) + l.confirmations);
    }
    return [...agg.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([cls, conf]) => ({ cls, pct: Math.min(99, 60 + conf * 8) }));
  }, [learnings]);

  return (
    <>
      {/* 3-column command-center grid (stacks below xl) */}
      <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[230px_minmax(0,1fr)_300px] xl:items-start">
        {/* LEFT — sparkline stat rail (2×2 grid when stacked) */}
        <StaggerGroup className="grid grid-cols-2 gap-3 xl:grid-cols-1">
          <StaggerItem>
            <StatSparkCard
              label="Knowledge Score"
              icon={Gauge}
              value={score != null ? `${Math.round(score * 100)}%` : '—'}
              delta={scoreDelta.text}
              deltaColor={scoreDelta.color}
              color={GREEN}
              series={seriesScore}
            />
          </StaggerItem>
          <StaggerItem>
            <StatSparkCard
              label="Patterns Learned"
              icon={Brain}
              value={String(stats.total)}
              delta={
                weekStats.patterns > 0
                  ? `+${weekStats.patterns} this week`
                  : 'no new patterns yet'
              }
              deltaColor={weekStats.patterns > 0 ? ORANGE_HI : undefined}
              color={ORANGE}
              series={seriesTotal}
            />
          </StaggerItem>
          <StaggerItem>
            <StatSparkCard
              label="Confirmations"
              icon={ThumbsUp}
              value={String(confirmationsTotal)}
              delta={
                weekStats.confirmations > 0
                  ? `+${weekStats.confirmations} this week`
                  : 'awaiting feedback'
              }
              deltaColor={weekStats.confirmations > 0 ? GREEN : undefined}
              color={GREEN}
              series={seriesConf}
            />
          </StaggerItem>
          <StaggerItem>
            <StatSparkCard
              label="Corrections"
              icon={ThumbsDown}
              value={String(stats.negative)}
              delta={
                weekStats.corrections > 0
                  ? `+${weekStats.corrections} this week`
                  : 'none this week'
              }
              deltaColor={weekStats.corrections > 0 ? RED : undefined}
              color={RED}
              series={seriesNeg}
            />
          </StaggerItem>
        </StaggerGroup>

        {/* CENTER — the brain + analyzing bar */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="pointer-events-none absolute left-4 top-3 z-10">
              <span
                className="text-[10px] uppercase tracking-[0.2em] text-white/40"
                style={{ fontFamily: MONO }}
              >
                Neural Core · {repo}
              </span>
            </div>
            <div className="pointer-events-none absolute right-4 top-3 z-10">
              <span
                className="text-[10px] uppercase tracking-[0.2em] text-white/40 tabular-nums"
                style={{ fontFamily: MONO }}
              >
                {loading ? 'Syncing' : `${stats.total} memories`}
              </span>
            </div>
            <NeuralCore
              learnings={learnings}
              level={level.index}
              onSelect={setSelected}
              className="h-[420px] w-full sm:h-[500px] xl:h-[560px]"
            />
            <FloatingTags tags={masteryTags} />
            {newborn && (
              <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
                <p className="max-w-sm rounded-xl border border-white/10 bg-black/70 px-4 py-2 text-center text-sm text-white/60 backdrop-blur-sm">
                  {NEWBORN_MESSAGE}
                </p>
              </div>
            )}
          </div>
          <AnalyzingBar latest={latest} />

        </div>

        {/* RIGHT — evolution ladder / growth / accuracy / learned today */}
        <div className="flex flex-col gap-4">
          <EvolutionLadder level={level} />
          <RepoGrowthCard learnings={learnings} />
          <AccuracyCard positive={stats.positive} negative={stats.negative} />
        </div>
      </div>

        {/* full-width bottom row — timeline · knowledge map · learned today */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        <TimelineCard
          learnings={sortedDesc}
          loading={loading}
          error={error}
          pendingId={pendingId}
          onSelect={setSelected}
          onRate={onRate}
          onRetry={refetch}
        />
        <GlassCard className="flex min-w-0 flex-col p-4">
          <span
            className="text-[10px] uppercase tracking-[0.18em] text-white/40"
            style={{ fontFamily: MONO }}
          >
            Knowledge Map
          </span>
          <div className="mt-3 overflow-hidden rounded-xl border border-white/5">
            <KnowledgeMap learnings={learnings} className="h-[260px]" />
          </div>
          <p
            className="mt-2.5 text-[9px] uppercase tracking-[0.16em] text-white/30"
            style={{ fontFamily: MONO }}
          >
            AI understanding of your incidents · clustered by error class
          </p>
        </GlassCard>
        <LearnedTodayCard learnings={sortedDesc} />
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

/* ── floating per-class mastery tags around the brain ────────────────────── */

const TAG_SLOTS: CSSProperties[] = [
  { top: '9%', left: '4%' },
  { top: '16%', right: '5%' },
  { top: '44%', left: '2%' },
  { top: '52%', right: '3%' },
  { top: '74%', left: '7%' },
  { top: '81%', right: '9%' },
];

function FloatingTags({ tags }: { tags: Array<{ cls: string; pct: number }> }) {
  return (
    <>
      {tags.map((t, i) => (
        <div
          key={t.cls}
          data-floating-tag
          data-sl-anim
          className="pointer-events-none absolute z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 backdrop-blur-sm"
          style={{
            ...TAG_SLOTS[i % TAG_SLOTS.length],
            animation: `sl-bob ${3.4 + i * 0.5}s ease-in-out ${i * 0.45}s infinite alternate`,
          }}
        >
          <span aria-hidden className="h-1 w-1 rounded-full bg-[#FF8233]" />
          <span className="text-[10px] text-white/75" style={{ fontFamily: MONO }}>
            {truncate(t.cls, 22)} ·{' '}
            <span className="text-[#52D273] tabular-nums">{t.pct}%</span>
          </span>
        </div>
      ))}
    </>
  );
}

/* ── analyzing bar (cosmetic ticker under the brain) ─────────────────────── */

function AnalyzingBar({ latest }: { latest: Learning | null }) {
  const [tick, setTick] = useState(37);
  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => (t + 1 + Math.floor(Math.random() * 4)) % 100);
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const label = latest
    ? truncate(latest.rootCause, 60)
    : 'awaiting the first signal from this repository';

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-3">
        <span
          className="min-w-0 truncate text-[10px] tracking-[0.08em] text-white/55"
          style={{ fontFamily: MONO }}
        >
          <span className="text-[#FF8233]">Learning from:</span> {label}
        </span>
        <span
          className="shrink-0 text-[10px] tabular-nums text-[#FF8233]"
          style={{ fontFamily: MONO }}
        >
          {tick}%
        </span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          data-sl-anim
          className="h-full w-1/3 rounded-full bg-gradient-to-r from-[#F16524] to-[#FF8233]"
          style={{ animation: 'sl-scan 2.6s linear infinite' }}
        />
      </div>
    </GlassCard>
  );
}

/* ── right-rail cards ────────────────────────────────────────────────────── */

function RepoGrowthCard({ learnings }: { learnings: Learning[] }) {
  const days = useMemo(() => growthByDay(learnings), [learnings]);
  const tick = { fill: 'rgba(255,255,255,0.35)', fontSize: 9, fontFamily: MONO };
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10px] uppercase tracking-[0.18em] text-white/40"
          style={{ fontFamily: MONO }}
        >
          Repository Growth
        </span>
        <span className="text-[10px] text-white/30" style={{ fontFamily: MONO }}>
          last 7 days
        </span>
      </div>
      <div
        className="mt-2 h-[120px]"
        role="img"
        aria-label="Cumulative learnings over the last 7 days"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={days} margin={{ top: 8, right: 6, bottom: 0, left: -18 }}>
            <XAxis
              dataKey="label"
              interval={0}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
              tick={tick}
            />
            <YAxis
              allowDecimals={false}
              width={28}
              tickLine={false}
              axisLine={false}
              tick={tick}
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke={GREEN}
              strokeWidth={2}
              dot={{ r: 2.5, fill: GREEN, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}

function AccuracyCard({ positive, negative }: { positive: number; negative: number }) {
  const signals = positive + negative;
  const score = signals > 0 ? positive / signals : null;
  return (
    <GlassCard className="p-4">
      <span
        className="text-[10px] uppercase tracking-[0.18em] text-white/40"
        style={{ fontFamily: MONO }}
      >
        Learning Accuracy
      </span>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        <span className="text-[34px] font-bold leading-none text-[#52D273] tabular-nums">
          {score != null ? `${Math.round(score * 100)}%` : '—'}
        </span>
        <div className="text-right">
          <div
            className="text-[9px] uppercase tracking-[0.16em] text-white/35"
            style={{ fontFamily: MONO }}
          >
            Predictions Correct
          </div>
          <div className="mt-0.5 text-sm font-semibold text-[#F5F5F2] tabular-nums">
            {positive} / {signals}
          </div>
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-[#52D273] transition-[width] duration-500"
          style={{ width: `${Math.round((score ?? 0) * 100)}%` }}
        />
      </div>
    </GlassCard>
  );
}

function LearnedTodayCard({ learnings }: { learnings: Learning[] }) {
  const recentPositive = useMemo(
    () => learnings.filter((l) => l.rating > 0).slice(0, 4),
    [learnings],
  );
  const scrollToTimeline = (): void => {
    document
      .getElementById('learning-timeline')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10px] uppercase tracking-[0.18em] text-white/40"
          style={{ fontFamily: MONO }}
        >
          What AI Learned Today
        </span>
        <button
          type="button"
          onClick={scrollToTimeline}
          className="text-[10px] text-[#FF8233] hover:underline"
          style={{ fontFamily: MONO }}
        >
          View all
        </button>
      </div>
      {recentPositive.length === 0 ? (
        <p className="mt-2.5 text-[11px] leading-relaxed text-white/40">
          No confirmed learnings yet — rate a finding with a thumbs-up to teach the AI.
        </p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-2.5">
          {recentPositive.map((l) => (
            <li key={l.id} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#52D273]" />
              <div className="min-w-0">
                <p className="truncate text-xs text-white/75" title={l.rootCause}>
                  {l.rootCause}
                </p>
                <p
                  className="mt-0.5 text-[9px] text-white/30"
                  style={{ fontFamily: MONO }}
                  title={absoluteTime(l.createdAt)}
                >
                  {relativeTime(l.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

/* ── learning timeline (bottom-left) ─────────────────────────────────────── */

function TimelineCard({
  learnings,
  loading,
  error,
  pendingId,
  onSelect,
  onRate,
  onRetry,
}: {
  /** Already sorted newest-first. */
  learnings: Learning[];
  loading: boolean;
  error: Error | null;
  pendingId: string | null;
  onSelect: (l: Learning) => void;
  onRate: (l: Learning, rating: -1 | 1) => Promise<void>;
  onRetry: () => void;
}) {
  const recent = learnings.slice(0, 8);
  return (
    <div id="learning-timeline" className="min-w-0 scroll-mt-24">
      <GlassCard className="flex min-w-0 flex-col p-4">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span
            className="text-[10px] uppercase tracking-[0.18em] text-white/40"
            style={{ fontFamily: MONO }}
          >
            Learning Timeline
          </span>
          {loading && (
            <span className="text-[10px] text-white/30" style={{ fontFamily: MONO }}>
              syncing…
            </span>
          )}
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
          <ul className="flex flex-col">
            {recent.map((l) => {
              const chip = SOURCE_CHIP[l.source] ?? SOURCE_CHIP.rating;
              const pending = pendingId === l.id;
              return (
                <li
                  key={l.id}
                  data-timeline-row
                  className="flex items-center gap-3 border-b border-white/5 py-2.5 last:border-0"
                >
                  <span
                    className="w-14 shrink-0 text-[10px] text-white/35 tabular-nums"
                    style={{ fontFamily: MONO }}
                    title={absoluteTime(l.createdAt)}
                  >
                    {relativeTime(l.createdAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelect(l)}
                    className="group min-w-0 flex-1 text-left"
                  >
                    <span
                      className="block truncate text-xs text-white/75 transition-colors group-hover:text-white"
                      title={l.rootCause}
                    >
                      {l.rootCause}
                    </span>
                  </button>
                  <span
                    className={`hidden shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] sm:inline-block ${chip.cls}`}
                    style={{ fontFamily: MONO }}
                  >
                    {chip.label}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      aria-label={`Confirm learning about ${l.errorClass}`}
                      disabled={pending}
                      onClick={() => void onRate(l, 1)}
                    >
                      <span style={{ color: l.rating > 0 ? GREEN : undefined }}>
                        <Icon icon={ThumbsUp} size={16} />
                      </span>
                    </IconButton>
                    <IconButton
                      aria-label={`Correct learning about ${l.errorClass}`}
                      disabled={pending}
                      onClick={() => void onRate(l, -1)}
                    >
                      <span style={{ color: l.rating < 0 ? RED : undefined }}>
                        <Icon icon={ThumbsDown} size={16} />
                      </span>
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}

/* ── selected-neuron detail (drawer body) ────────────────────────────────── */

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
      <span
        className="text-[10px] uppercase tracking-[0.18em] text-white/40"
        style={{ fontFamily: MONO }}
      >
        {label}
      </span>
      <p className="mt-1 whitespace-pre-wrap text-body text-ink">{children}</p>
    </div>
  );
}
