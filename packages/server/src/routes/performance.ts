import type { FastifyInstance } from 'fastify';
import type { EndpointPerformance } from '@oncall/shared';
import type { AppContext } from '../app.js';
import {
  metricsFromRow,
  scoreWindow,
  toEndpointPerformance,
  type ScoreContext,
} from '../detection/performance-ticker.js';

/**
 * `GET /api/v1/performance` (AI Incident PREVENTION Phase 1). The latest window
 * per (service, endpoint) with its 0-100 performance score breakdown and breach
 * prediction, worst score first — the source the dashboard's Performance Ticker
 * renders.
 *
 * Rows are read from `api_performance_samples` (one per endpoint, newest window
 * wins). The nested `score`/`prediction` objects are reconstructed from the
 * stored window metrics + trailing history with the same pure helpers the ticker
 * used to write them, so the DTO is an exact, deterministic function of the rows.
 * Open like the other read routes — the samples carry no customer dimension.
 */

/** Trailing samples pulled per endpoint to rebuild its baseline + trend. */
const HISTORY_LIMIT = 20;

export function registerPerformanceRoute(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  const { db, config } = ctx;

  app.get('/api/v1/performance', async (_req, reply) => {
    const scoreCtx: ScoreContext = {
      thresholdMs: config.detection.latencyP95ThresholdMs,
      windowMinutes: config.performance.windowSec / 60,
      minRequests: config.detection.minRequestsForDetection,
    };

    const latest = await db.dao.apiPerformance.latestPerService();
    const endpoints: EndpointPerformance[] = [];
    for (const row of latest) {
      const priorRows = await db.dao.apiPerformance.listRecentForEndpoint(
        row.service_name,
        row.endpoint,
        HISTORY_LIMIT,
      );
      const oldestFirst = [...priorRows].reverse();
      const m = metricsFromRow(row);
      const scored = scoreWindow(m, oldestFirst, scoreCtx);
      endpoints.push(toEndpointPerformance(m, scored));
    }

    // Worst score first so the dashboard leads with the most at-risk endpoints.
    endpoints.sort((a, b) => a.score.overall_score - b.score.overall_score);

    return reply.code(200).send({ endpoints, generatedAt: Date.now() });
  });
}
