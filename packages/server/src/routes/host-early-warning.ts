import type { FastifyInstance } from 'fastify';
import {
  HOST_METRIC_NAMES,
  type HostEarlyWarningMetric,
  type RiskStatus,
} from '@oncall/shared';
import type { AppContext } from '../app.js';
import {
  computeHostMetric,
  hostMetricColumn,
  hostRiskServiceKey,
  hostThreshold,
} from '../detection/host-ticker.js';

/**
 * `GET /api/v1/host-early-warning` (AI Incident PREVENTION — HOST layer).
 *
 * The live HOST early-warning surface the dashboard's "AI EARLY WARNING" card
 * renders: one row per (service, metric in [cpu, mem, db_pool]) with the current
 * reading, a 0-100 `bars` gauge fill, the durable flap-protected status, the
 * breach probability + ETA, the metric threshold, a heuristic `likelyCause` +
 * `recommendedAction`, and a short `series` for the sparkline.
 *
 * Trend/prediction is reconstructed from the stored `host_metric_samples` with
 * the SAME pure {@link computeHostMetric} helper the host-ticker used to write
 * the risk states, so the DTO is a deterministic function of the rows. The
 * durable escalation `status` is read from `risk_states` (falling back to the
 * fresh prediction's status before the first tick has run). Open like the other
 * read routes — host samples carry no customer dimension.
 */

/** Trailing readings pulled per metric for the sparkline + trend. */
const HISTORY_LIMIT = 30;

/** How far back (window multiples) a service must have reported to be listed. */
const SERVICE_LOOKBACK_WINDOWS = 10;

/** Severity ordering so the most at-risk metric leads the response. */
const STATUS_RANK: Record<RiskStatus, number> = {
  NORMAL: 0,
  RECOVERED: 0,
  EARLY_RISK: 1,
  WARNING: 2,
  ESCALATED: 3,
  BREACHED: 4,
};

function clampBar(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function registerHostEarlyWarningRoute(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  const { db, config } = ctx;

  app.get('/api/v1/host-early-warning', async (_req, reply) => {
    const now = Date.now();
    const lookback = config.host.windowSec * SERVICE_LOOKBACK_WINDOWS * 1000;
    const services = await db.dao.hostMetricSamples.listServicesInWindow(
      now - lookback,
      now,
    );

    const metrics: HostEarlyWarningMetric[] = [];
    for (const service of services) {
      for (const metric of HOST_METRIC_NAMES) {
        const series = await db.dao.hostMetricSamples.recentSeries(
          service,
          hostMetricColumn(metric),
          HISTORY_LIMIT,
        );
        const computed = computeHostMetric(
          service,
          metric,
          series,
          hostThreshold(config, metric),
        );
        if (!computed) continue;

        const rs = await db.dao.riskStates.get(
          hostRiskServiceKey(service),
          metric,
        );
        const status = ((rs?.status as RiskStatus | undefined) ??
          computed.prediction.status) as RiskStatus;

        metrics.push({
          service: computed.service,
          metric: computed.metric,
          current: Math.round(computed.current * 10) / 10,
          bars: clampBar(computed.current),
          status,
          probability: computed.prediction.probability,
          minutesToBreach: computed.prediction.minutesToBreach,
          threshold: computed.threshold,
          likelyCause: computed.likelyCause,
          recommendedAction: computed.recommendedAction,
          series: computed.series,
        });
      }
    }

    // Most at-risk first: by durable status, then breach probability, then how
    // far the reading has climbed toward its threshold.
    metrics.sort((a, b) => {
      const rank = STATUS_RANK[b.status] - STATUS_RANK[a.status];
      if (rank !== 0) return rank;
      if (b.probability !== a.probability) return b.probability - a.probability;
      return b.current / b.threshold - a.current / a.threshold;
    });

    return reply.code(200).send({ metrics, generatedAt: now });
  });
}
