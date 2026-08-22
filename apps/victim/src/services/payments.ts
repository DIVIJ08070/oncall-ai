/**
 * payments-api — charges & refunds for the demo commerce platform.
 *
 *   POST /api/payments/charge         { amount, currency, token } -> { txnId, status }
 *   POST /api/payments/refund/:txnId  { amount? }                 -> { txnId, status }
 *   GET  /api/payments/:txnId         -> transaction record
 *
 * Payments are the slowest domain (~60–140ms). ~2% of charges are declined (402)
 * for a realistic baseline error rate.
 */

import { Router } from 'express';
import { asyncRoute, delay, jitter, maybeFail, txnId } from '../lib/sim.js';

export const paymentsRouter = Router();

const CURRENCIES = new Set(['usd', 'eur', 'gbp', 'cad', 'aud']);

paymentsRouter.post(
  '/charge',
  asyncRoute(async (req, res) => {
    await delay(jitter(100));
    const { amount, currency, token } = (req.body ?? {}) as {
      amount?: number;
      currency?: string;
      token?: string;
    };
    if (!Number.isFinite(amount) || (amount as number) <= 0 || !token) {
      return res.status(400).json({
        error: { code: 'validation_error', message: 'amount (>0) and token are required' },
      });
    }
    const cur = (currency ?? 'usd').toLowerCase();
    if (!CURRENCIES.has(cur)) {
      return res.status(400).json({
        error: { code: 'unsupported_currency', message: `currency ${cur} is not supported` },
      });
    }
    // ~2% declines — a realistic baseline error rate.
    if (maybeFail(0.02)) {
      return res.status(402).json({
        error: { code: 'card_declined', message: 'the card was declined' },
      });
    }
    return res.status(201).json({
      txnId: txnId(),
      status: 'succeeded',
      amount,
      currency: cur,
    });
  }),
);

paymentsRouter.post(
  '/refund/:txnId',
  asyncRoute(async (req, res) => {
    await delay(jitter(90));
    const { amount } = (req.body ?? {}) as { amount?: number };
    return res.status(201).json({
      txnId: req.params.txnId,
      refundId: txnId(),
      status: 'refunded',
      amount: Number.isFinite(amount) ? amount : null,
    });
  }),
);

paymentsRouter.get(
  '/:txnId',
  asyncRoute(async (req, res) => {
    await delay(jitter(45));
    return res.status(200).json({
      txnId: req.params.txnId,
      status: 'succeeded',
      currency: 'usd',
    });
  }),
);
