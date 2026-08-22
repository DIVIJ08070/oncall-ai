import type {
  AlertStep,
  EscalationChannel,
  EscalationStepKind,
  RiskStatus,
} from '@oncall/shared';
import type { Config } from '../../config.js';
import type { OncallDb } from '../../db/index.js';
import type { AlertRow } from '../../db/rows.js';
import type { Broker } from '../../sse/broker.js';
import { performanceTopic } from '../../detection/performance-ticker.js';
import {
  createChannelRegistry,
  type ChannelRegistry,
  type ChannelSendInput,
  type FetchLike,
} from './channels.js';

/**
 * Escalation policy engine (AI Incident PREVENTION — ESCALATE IF IGNORED).
 *
 * Driven from the host + performance tickers: each window, per risky
 * (service, metric/endpoint), the ticker calls {@link onRiskUpdate} with the
 * durable risk status. The engine owns a small ladder:
 *
 *   EARLY_RISK → dashboard
 *   WARNING    → dashboard + EMAIL ("warning")
 *   CRITICAL   → EMAIL ("critical") — fires ONLY when a WARNING is still
 *                unacknowledged after `ACK_GRACE_SEC` AND still elevated
 *   RECOVERY   → dashboard + EMAIL ("resolved") — when it returns to normal
 *
 * Each rung fires at most once per alert (deduped via the alert's `step`
 * marker + `last_escalated_at`). Acknowledging an alert stops further
 * escalation. Every channel send persists an `alert_notifications` row and
 * streams an `escalation_notice` SSE; a recovery streams `recovery_notice`.
 */

/**
 * The channel ladder per rung. Only ENABLED channels (see the registry) actually
 * fire; a disabled name is skipped. To page on-call by SMS/WhatsApp once real
 * creds exist, enable them in the registry AND add them to the CRITICAL rung:
 *   CRITICAL: ['email', 'sms', 'whatsapp'],
 */
const LADDER: Record<EscalationStepKind, EscalationChannel[]> = {
  EARLY_RISK: ['dashboard'],
  WARNING: ['dashboard', 'email'],
  CRITICAL: ['email'],
  RECOVERY: ['dashboard', 'email'],
};

/** Severity rank per status — NORMAL and the cooled RECOVERED sit at the floor. */
const RANK: Record<RiskStatus, number> = {
  NORMAL: 0,
  RECOVERED: 0,
  EARLY_RISK: 1,
  WARNING: 2,
  ESCALATED: 3,
  BREACHED: 4,
};

/** The ordered ladder rungs an alert climbs (CRITICAL is ack-timeout-only). */
const STEP_ORDER: readonly AlertStep[] = ['EARLY_RISK', 'WARNING', 'CRITICAL'];

/**
 * The highest ladder rung a status alone justifies (WITHOUT the ack timeout).
 * EARLY_RISK → EARLY_RISK; anything WARNING-or-worse → WARNING (email sent).
 * CRITICAL is never reached from status — only from an ignored WARNING.
 */
function baselineStep(status: RiskStatus): AlertStep | null {
  if (RANK[status] <= 0) return null;
  if (status === 'EARLY_RISK') return 'EARLY_RISK';
  return 'WARNING';
}

function stepIndex(step: string | null | undefined): number {
  if (!step) return -1;
  return STEP_ORDER.indexOf(step as AlertStep);
}

export type EscalationLogger = (message: string, meta?: unknown) => void;

/** One risk-state update the tickers hand to the engine each window. */
export interface RiskUpdate {
  source: 'host' | 'api';
  /** Display service name (e.g. `payments-api`). */
  service: string;
  /** cpu | mem | db_pool, or the endpoint path for api alerts. */
  metric: string;
  /** `risk_states.service_name` key (`host:<svc>` | real service). */
  riskService: string;
  /** `risk_states.endpoint` key (metric | endpoint). */
  riskEndpoint: string;
  prevStatus: RiskStatus;
  status: RiskStatus;
  current: number | null;
  threshold: number | null;
  probability: number | null;
  minutesToBreach: number | null;
  likelyCause: string | null;
  recommendedAction: string | null;
  title: string;
  now: number;
}

export interface EscalationEngineDeps {
  db: OncallDb;
  config: Config;
  broker?: Broker;
  logger?: EscalationLogger;
  /** Injected fetch for the email webhook mirror (tests). */
  fetchImpl?: FetchLike;
  /** Injected channel registry (tests); defaults to the real registry. */
  channels?: ChannelRegistry;
}

export class EscalationEngine {
  private readonly db: OncallDb;
  private readonly config: Config;
  private readonly broker?: Broker;
  private readonly log: EscalationLogger;
  private readonly channels: ChannelRegistry;

  constructor(deps: EscalationEngineDeps) {
    this.db = deps.db;
    this.config = deps.config;
    this.broker = deps.broker;
    this.log = deps.logger ?? (() => {});
    this.channels =
      deps.channels ?? createChannelRegistry(deps.config, deps.fetchImpl);
  }

  /**
   * Advance the escalation ladder for one risk-state unit. Idempotent per
   * window: opens/refreshes the alert, fires any newly-reached rungs, promotes a
   * still-ignored WARNING to CRITICAL after the grace window, and resolves +
   * fires RECOVERY when the unit returns to normal. Never throws (a failure here
   * must not sink a detection tick).
   */
  async onRiskUpdate(u: RiskUpdate): Promise<void> {
    if (!this.config.escalation.enabled) return;
    try {
      await this.evaluate(u);
    } catch (err) {
      this.log('[escalation] evaluate failed', err);
    }
  }

  private async evaluate(u: RiskUpdate): Promise<void> {
    const existing = await this.db.dao.alerts.getByRiskKey(
      u.riskService,
      u.riskEndpoint,
    );
    const elevated = RANK[u.status] > 0;

    if (!elevated) {
      await this.handleNormal(existing, u);
      return;
    }

    let alert = await this.ensureOpen(existing, u);

    // Fire every rung from the current step up to the status baseline (walks
    // intermediate rungs so the ladder is visible even when the durable status
    // jumps, e.g. NORMAL → BREACHED in one window).
    const baseline = baselineStep(u.status);
    const baselineIdx = stepIndex(baseline);
    for (let i = stepIndex(alert.step) + 1; i <= baselineIdx; i++) {
      const step = STEP_ORDER[i]!;
      alert = await this.fireStep(alert, step, u);
    }

    // CRITICAL — the "escalate if ignored" rung. Only when a WARNING is still
    // unacknowledged past the grace window AND still elevated (>= WARNING).
    if (
      alert.step === 'WARNING' &&
      alert.acknowledged === 0 &&
      RANK[u.status] >= RANK.WARNING &&
      alert.warning_at != null &&
      u.now - alert.warning_at >= this.config.escalation.ackGraceSec * 1000
    ) {
      alert = await this.fireStep(alert, 'CRITICAL', u);
    }
  }

  /** Open a fresh alert, or reopen a resolved one, or refresh a live one. */
  private async ensureOpen(
    existing: AlertRow | null,
    u: RiskUpdate,
  ): Promise<AlertRow> {
    if (!existing) {
      return this.db.dao.alerts.create({
        source: u.source,
        service: u.service,
        metric: u.metric,
        risk_service: u.riskService,
        risk_endpoint: u.riskEndpoint,
        title: u.title,
        status: u.status,
        step: null,
        current_value: u.current,
        threshold: u.threshold,
        probability: u.probability,
        minutes_to_breach: u.minutesToBreach,
        likely_cause: u.likelyCause,
        recommended_action: u.recommendedAction,
        first_detected_at: u.now,
        created_at: u.now,
        updated_at: u.now,
      });
    }
    if (existing.resolved_at != null) {
      // Reopen a previously-resolved alert for a fresh episode.
      return (
        (await this.db.dao.alerts.update(existing.id, {
          status: u.status,
          step: null,
          current_value: u.current,
          threshold: u.threshold,
          probability: u.probability,
          minutes_to_breach: u.minutesToBreach,
          likely_cause: u.likelyCause,
          recommended_action: u.recommendedAction,
          acknowledged: false,
          acknowledged_at: null,
          acknowledged_by: null,
          first_detected_at: u.now,
          last_escalated_at: null,
          warning_at: null,
          resolved_at: null,
          updated_at: u.now,
        })) ?? existing
      );
    }
    // Refresh the live prediction snapshot (keeps ack + step + timers).
    return (
      (await this.db.dao.alerts.update(existing.id, {
        status: u.status,
        current_value: u.current,
        threshold: u.threshold,
        probability: u.probability,
        minutes_to_breach: u.minutesToBreach,
        likely_cause: u.likelyCause,
        recommended_action: u.recommendedAction,
        updated_at: u.now,
      })) ?? existing
    );
  }

  /** Fire one ladder rung across its enabled channels, then advance the step. */
  private async fireStep(
    alert: AlertRow,
    step: AlertStep,
    u: RiskUpdate,
  ): Promise<AlertRow> {
    // Dedupe: never fire a rung at or below the one already reached.
    if (stepIndex(step) <= stepIndex(alert.step)) return alert;

    const ignoredForSec =
      step === 'CRITICAL' && alert.warning_at != null
        ? Math.round((u.now - alert.warning_at) / 1000)
        : null;
    const input = this.sendInput(u, alert.id, ignoredForSec);

    await this.deliver(alert.id, step, input, u);

    const patch: Parameters<OncallDb['dao']['alerts']['update']>[1] = {
      step,
      last_escalated_at: u.now,
      updated_at: u.now,
    };
    if (step === 'WARNING') patch.warning_at = u.now;
    return (await this.db.dao.alerts.update(alert.id, patch)) ?? { ...alert, step };
  }

  /** Resolve an active alert + fire the RECOVERY notice; else quietly close. */
  private async handleNormal(
    existing: AlertRow | null,
    u: RiskUpdate,
  ): Promise<void> {
    if (!existing || existing.resolved_at != null) return;

    await this.db.dao.alerts.update(existing.id, {
      status: u.status,
      current_value: u.current,
      resolved_at: u.now,
      updated_at: u.now,
    });

    // Only announce RECOVERY for alerts that actually escalated (fired a rung).
    if (existing.step == null) return;

    const input = this.sendInput(u, existing.id, null);
    await this.deliver(existing.id, 'RECOVERY', input, u);

    this.publishRecovery(existing.id, u);
  }

  /** Send one rung across its ladder channels, persisting + streaming each. */
  private async deliver(
    alertId: string,
    step: EscalationStepKind,
    input: ChannelSendInput,
    u: RiskUpdate,
  ): Promise<void> {
    const acknowledged = await this.isAcknowledged(alertId);
    for (const channelName of LADDER[step]) {
      if (!this.channels.isEnabled(channelName)) continue; // stub / disabled
      const adapter = this.channels.get(channelName);
      if (!adapter) continue;
      let result;
      try {
        result = await adapter.send(input, step);
      } catch (err) {
        this.log('[escalation] channel send failed', { channelName, err });
        result = {
          status: 'failed' as const,
          message: `send failed on ${channelName}`,
          payload: { channel: channelName, step, error: true },
        };
      }
      try {
        await this.db.dao.alertNotifications.insert({
          alert_id: alertId,
          step,
          channel: channelName,
          status: result.status,
          message: result.message,
          payload: result.payload,
          created_at: u.now,
        });
      } catch (err) {
        this.log('[escalation] failed to persist notification', err);
      }
      this.publishEscalation(alertId, step, channelName, result.status, result.message, acknowledged, u);
    }
  }

  private async isAcknowledged(alertId: string): Promise<boolean> {
    const row = await this.db.dao.alerts.getById(alertId);
    return (row?.acknowledged ?? 0) !== 0;
  }

  private sendInput(
    u: RiskUpdate,
    alertId: string,
    ignoredForSec: number | null,
  ): ChannelSendInput {
    return {
      alertId,
      source: u.source,
      service: u.service,
      metric: u.metric,
      status: u.status,
      current: u.current,
      threshold: u.threshold,
      probability: u.probability,
      minutesToBreach: u.minutesToBreach,
      likelyCause: u.likelyCause,
      recommendedAction: u.recommendedAction,
      ignoredForSec,
      dashboardUrl: this.config.server.dashboardUrl,
      now: u.now,
    };
  }

  private publishEscalation(
    alertId: string,
    step: EscalationStepKind,
    channel: EscalationChannel,
    status: string,
    message: string,
    acknowledged: boolean,
    u: RiskUpdate,
  ): void {
    this.broker?.publish(performanceTopic(), {
      event: 'escalation_notice',
      data: {
        alertId,
        source: u.source,
        service: u.service,
        metric: u.metric,
        step,
        channel,
        status,
        message,
        acknowledged,
        at: u.now,
      },
    });
  }

  private publishRecovery(alertId: string, u: RiskUpdate): void {
    this.broker?.publish(performanceTopic(), {
      event: 'recovery_notice',
      data: {
        alertId,
        source: u.source,
        service: u.service,
        metric: u.metric,
        message: `${u.service} ${u.metric} recovered — back within normal range.`,
        at: u.now,
      },
    });
  }
}

/** Factory mirroring the detection-engine / ticker convention. */
export function createEscalationEngine(
  deps: EscalationEngineDeps,
): EscalationEngine {
  return new EscalationEngine(deps);
}
