import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  Check,
  CircleAlert,
  LayoutDashboard,
  Mail,
  MessageCircle,
  MessageSquare,
  ShieldCheck,
  Siren,
} from 'lucide-react';
import type {
  AlertStep,
  AlertTimeline as AlertTimelineDto,
  EscalationChannel,
  EscalationStep,
  EscalationStepKind,
} from '@oncall/shared';
import { getAlerts, ackAlert } from '../../../api/alerts';
import { usePolling } from '../../../hooks/usePolling';
import { GlassCard, MONO } from '../../../components/shell/UnifiedChrome';
import { relativeTime, absoluteTime } from '../../../lib/format';
import { GREEN, AMBER, ORANGE, RED } from '../lib/model';

/**
 * EscalationTimeline — the mockup's "ESCALATE IF IGNORED" ladder (AI Incident
 * PREVENTION). Polls `GET /api/v1/alerts` every 5s and renders the lead alert's
 * escalation as a vertical timeline: each fired step shows its channel icon, rung
 * label, timestamp, and the simulated message preview (Dashboard alert → Email →
 * CRITICAL email). While the alert is unacknowledged it shows a live "waiting Ns
 * for acknowledgement…" grace countdown and an ACKNOWLEDGE button that calls
 * `POST /alerts/:id/ack` to stop the climb; when the metric returns to normal a
 * green RECOVERED banner replaces it. SMS / WhatsApp render as greyed "coming
 * soon" rungs — they never fire. Renders nothing when no alert is in play.
 */

const POLL_MS = 5_000;

const STEP_RANK: Record<AlertStep, number> = { CRITICAL: 3, WARNING: 2, EARLY_RISK: 1 };

const STEP_COLOR: Record<EscalationStepKind, string> = {
  EARLY_RISK: AMBER,
  WARNING: ORANGE,
  CRITICAL: RED,
  RECOVERY: GREEN,
};

const STEP_LABEL: Record<EscalationStepKind, string> = {
  EARLY_RISK: 'Early risk',
  WARNING: 'Warning',
  CRITICAL: 'Critical',
  RECOVERY: 'Recovered',
};

const CHANNEL_ICON: Record<EscalationChannel, typeof Mail> = {
  dashboard: LayoutDashboard,
  email: Mail,
  sms: MessageSquare,
  whatsapp: MessageCircle,
};

const CHANNEL_LABEL: Record<EscalationChannel, string> = {
  dashboard: 'Dashboard',
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
};

/** Highest-severity alert to surface: active first, then unacknowledged, then rung. */
function leadAlert(alerts: readonly AlertTimelineDto[]): AlertTimelineDto | null {
  if (alerts.length === 0) return null;
  const active = alerts.filter((a) => a.active);
  const pool = active.length > 0 ? active : alerts;
  const score = (a: AlertTimelineDto): number =>
    (a.active ? 1e9 : 0) +
    (a.acknowledged ? 0 : 5e8) +
    (a.step ? STEP_RANK[a.step] : 0) * 1e6 +
    (a.lastEscalatedAt ?? a.firstDetectedAt) / 1e3;
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

/** Humanise an elapsed-seconds grace window: "42s", "3m 05s". */
function graceLabel(sec: number): string {
  if (sec < 90) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** A 1s ticker (only while `on`) so the grace countdown advances smoothly. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

export function EscalationTimeline() {
  const { data, error, refetch } = usePolling(
    (signal) => getAlerts(signal),
    [],
    { intervalMs: POLL_MS },
  );

  const alerts = useMemo(() => data?.alerts ?? [], [data]);
  const alert = useMemo(() => leadAlert(alerts), [alerts]);

  const [acking, setAcking] = useState(false);
  const ackedRef = useRef<string | null>(null);

  const recovered = alert != null && (alert.resolvedAt != null || !alert.active);
  const waiting =
    alert != null && alert.active && !alert.acknowledged && alert.resolvedAt == null;
  const now = useNow(waiting);

  if (error && alerts.length === 0) return null;
  if (alert == null) return null;

  const steps = alert.timeline;
  const headColor = recovered
    ? GREEN
    : alert.step
      ? STEP_COLOR[alert.step]
      : AMBER;

  const graceSec =
    alert.lastEscalatedAt != null ? Math.max(0, Math.floor((now - alert.lastEscalatedAt) / 1000)) : 0;

  const onAck = async (): Promise<void> => {
    if (acking || alert.acknowledged) return;
    setAcking(true);
    ackedRef.current = alert.id;
    try {
      await ackAlert(alert.id);
      refetch();
    } catch {
      /* leave the button live so the operator can retry */
    } finally {
      setAcking(false);
    }
  };

  return (
    <GlassCard className="w-full p-4 sm:p-5 lg:w-[400px] lg:shrink-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg border"
            style={{ color: headColor, borderColor: headColor + '55', backgroundColor: headColor + '1f' }}
          >
            {recovered ? <ShieldCheck className="h-4 w-4" /> : <Siren className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <span
              className="block text-[10px] uppercase tracking-[0.24em] text-white/45"
              style={{ fontFamily: MONO }}
            >
              Escalate if ignored
            </span>
            <span className="block truncate text-sm font-semibold text-white" title={alert.title}>
              {alert.title}
            </span>
          </div>
        </div>
        <span
          className="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]"
          style={{ fontFamily: MONO, color: headColor, borderColor: headColor + '55', backgroundColor: headColor + '1f' }}
        >
          {recovered ? 'recovered' : alert.step ? STEP_LABEL[alert.step] : 'open'}
        </span>
      </div>

      {/* Recovered banner */}
      {recovered && (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-[#52D273]/30 bg-[#52D273]/[0.08] px-3.5 py-3">
          <ShieldCheck className="h-4 w-4 shrink-0 text-[#52D273]" />
          <p className="text-xs text-white/80">
            <span className="font-semibold text-[#52D273]">Recovered</span> — {alert.service}{' '}
            {alert.metric} returned to normal
            {alert.resolvedAt != null && (
              <span className="text-white/45"> · {relativeTime(alert.resolvedAt)}</span>
            )}
          </p>
        </div>
      )}

      {/* Timeline */}
      <ol className="mt-4 flex flex-col">
        {steps.map((s, i) => (
          <TimelineStep key={s.id} step={s} isLast={i === steps.length - 1 && !waiting} />
        ))}

        {/* Live grace countdown before the next rung */}
        {waiting && (
          <li className="relative flex gap-3 pb-1 pl-0">
            <div className="flex w-5 shrink-0 flex-col items-center">
              <span className="absolute top-0 h-full w-px bg-white/10" style={{ left: '9px' }} />
              <span className="z-10 mt-1 h-2.5 w-2.5 rounded-full border border-white/30 bg-[#0d0d12] motion-safe:animate-pulse-live" />
            </div>
            <div className="pb-3">
              <span className="text-[11px] tabular-nums text-white/50" style={{ fontFamily: MONO }}>
                waiting {graceLabel(graceSec)} for acknowledgement…
              </span>
              <p className="mt-0.5 text-[11px] text-white/35">
                Escalates to the next channel if nobody acknowledges.
              </p>
            </div>
          </li>
        )}

        {/* Disabled future rungs — never fire */}
        {!recovered &&
          (['sms', 'whatsapp'] as EscalationChannel[]).map((ch) => (
            <GhostRung key={ch} channel={ch} />
          ))}
      </ol>

      {/* Acknowledge / acknowledged state */}
      <div className="mt-3 border-t border-white/10 pt-3">
        {alert.acknowledged ? (
          <div className="flex items-center gap-2 text-xs text-white/60">
            <Check className="h-3.5 w-3.5 shrink-0 text-[#52D273]" />
            Acknowledged
            {alert.acknowledgedBy && <span className="text-white/45">by {alert.acknowledgedBy}</span>}
            {alert.acknowledgedAt != null && (
              <span className="text-white/40" title={absoluteTime(alert.acknowledgedAt)}>
                · {relativeTime(alert.acknowledgedAt)}
              </span>
            )}
            <span className="text-white/40">· escalation stopped</span>
          </div>
        ) : recovered ? (
          <p className="text-xs text-white/45">No action needed — the alert cleared on its own.</p>
        ) : (
          <button
            type="button"
            onClick={() => void onAck()}
            disabled={acking}
            className="inline-flex items-center gap-2 rounded-lg border border-[#F16524]/50 bg-[#F16524]/15 px-3.5 py-2 text-xs font-semibold text-[#FF8233] transition-colors hover:bg-[#F16524]/25 hover:text-white disabled:opacity-60 motion-reduce:transition-none"
          >
            <BellRing className="h-3.5 w-3.5" />
            {acking ? 'Acknowledging…' : 'Acknowledge'}
          </button>
        )}
      </div>
    </GlassCard>
  );
}

function TimelineStep({ step, isLast }: { step: EscalationStep; isLast: boolean }) {
  const color = STEP_COLOR[step.step];
  const ChannelIcon = CHANNEL_ICON[step.channel];
  const isRecovery = step.step === 'RECOVERY';

  return (
    <li className="relative flex gap-3">
      {/* Rail + node */}
      <div className="flex w-5 shrink-0 flex-col items-center">
        {!isLast && <span className="absolute top-3 h-full w-px bg-white/10" style={{ left: '9px' }} />}
        <span
          className="z-10 mt-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border"
          style={{ color, borderColor: color + '77', backgroundColor: color + '22' }}
        >
          {isRecovery ? <Check className="h-2.5 w-2.5" /> : <ChannelIcon className="h-2.5 w-2.5" />}
        </span>
      </div>

      {/* Body */}
      <div className={`min-w-0 flex-1 ${isLast ? 'pb-1' : 'pb-4'}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-semibold" style={{ color }}>
            {STEP_LABEL[step.step]}
          </span>
          <span
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-white/45"
            style={{ fontFamily: MONO }}
          >
            <ChannelIcon className="h-3 w-3" />
            {CHANNEL_LABEL[step.channel]}
          </span>
          <span
            className="ml-auto shrink-0 text-[10px] tabular-nums text-white/35"
            style={{ fontFamily: MONO }}
            title={absoluteTime(step.at)}
          >
            {relativeTime(step.at)}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-white/60">{step.message}</p>
      </div>
    </li>
  );
}

/** A greyed, never-fired ladder rung (SMS / WhatsApp) labelled "coming soon". */
function GhostRung({ channel }: { channel: EscalationChannel }) {
  const Icon = CHANNEL_ICON[channel];
  return (
    <li className="relative flex gap-3 opacity-45">
      <div className="flex w-5 shrink-0 flex-col items-center">
        <span
          className="z-10 mt-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-dashed border-white/25 bg-transparent"
        >
          <Icon className="h-2.5 w-2.5 text-white/40" />
        </span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 pb-3">
        <span
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-white/45"
          style={{ fontFamily: MONO }}
        >
          <CircleAlert className="h-3 w-3" />
          {CHANNEL_LABEL[channel]}
        </span>
        <span className="text-[10px] italic text-white/35">coming soon — not wired</span>
      </div>
    </li>
  );
}
