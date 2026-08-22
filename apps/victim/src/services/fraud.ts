/**
 * fraud-detection-ai — real-time transaction risk scoring (SPEC §12 AI plane).
 *
 *   POST /api/fraud/score        { txnId, amount, userId } -> risk decision
 *   GET  /api/fraud/score/:txnId                           -> prior decision (simulated)
 *   GET  /api/fraud/signals                                -> model signal catalog
 *
 * Model-inference shaped: `model`, `riskScore` (0–1), a categorical `decision`,
 * contributing `signals`, and `latencyMs` (~120–300ms). ~3% of scores land in
 * "review" and a small fraction of high-value charges "deny", so the service score
 * is believable rather than a flat 100.
 */

import { Router } from 'express';
import { asyncRoute, delay, jitter, maybeFail, round } from '../lib/sim.js';

export const fraudRouter = Router();

const MODEL = 'fraud-gbm-v2';

const APPROVE_SIGNALS = [
  'velocity_ok',
  'geo_match',
  'device_known',
  'email_age_ok',
  'bin_reputation_ok',
] as const;

const RISK_SIGNALS = [
  'velocity_spike',
  'geo_mismatch',
  'new_device',
  'disposable_email',
  'bin_high_risk',
  'amount_anomaly',
] as const;

/** Pick `n` distinct signals from a pool. */
function signalsFrom(pool: readonly string[], n: number): string[] {
  return pool.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(n, pool.length));
}

fraudRouter.post(
  '/score',
  asyncRoute(async (req, res) => {
    const latencyMs = jitter(200, 0.45); // ~110–290ms
    await delay(latencyMs);
    const { txnId, amount, userId } = (req.body ?? {}) as {
      txnId?: string;
      amount?: number;
      userId?: string;
    };
    if (!txnId || !Number.isFinite(amount) || (amount as number) <= 0) {
      return res.status(400).json({
        error: { code: 'validation_error', message: 'txnId and a positive amount are required' },
      });
    }

    const amt = amount as number;
    let decision: 'approve' | 'review' | 'deny';
    let riskScore: number;
    let signals: string[];

    // ~1% hard deny (weighted toward high-value charges), ~3% manual review.
    if (maybeFail(0.01) && amt > 250) {
      decision = 'deny';
      riskScore = round(0.85 + Math.random() * 0.14, 3);
      signals = signalsFrom(RISK_SIGNALS, 3);
    } else if (maybeFail(0.03)) {
      decision = 'review';
      riskScore = round(0.5 + Math.random() * 0.25, 3);
      signals = signalsFrom(RISK_SIGNALS, 2);
    } else {
      decision = 'approve';
      riskScore = round(Math.random() * 0.3, 3);
      signals = signalsFrom(APPROVE_SIGNALS, 3);
    }

    return res.status(200).json({
      model: MODEL,
      txnId,
      userId: userId ?? null,
      riskScore,
      decision,
      signals,
      latencyMs,
    });
  }),
);

fraudRouter.get(
  '/score/:txnId',
  asyncRoute(async (req, res) => {
    const latencyMs = jitter(60, 0.35);
    await delay(latencyMs);
    return res.status(200).json({
      model: MODEL,
      txnId: req.params.txnId,
      riskScore: round(Math.random() * 0.3, 3),
      decision: 'approve',
      cached: true,
      latencyMs,
    });
  }),
);

fraudRouter.get(
  '/signals',
  asyncRoute(async (_req, res) => {
    const latencyMs = jitter(40, 0.35);
    await delay(latencyMs);
    return res.status(200).json({
      model: MODEL,
      approveSignals: APPROVE_SIGNALS,
      riskSignals: RISK_SIGNALS,
    });
  }),
);
