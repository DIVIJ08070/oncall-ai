/**
 * auth-api — session/identity service for the demo commerce platform.
 *
 *   POST /api/auth/login    { email, password } -> { token, userId, expiresIn }
 *   POST /api/auth/refresh  { token }           -> { token, expiresIn }
 *   GET  /api/auth/me       (Bearer token)      -> user profile
 *
 * Auth is fast (~15–40ms). ~1% of logins return a realistic 401 so the service
 * score is believable rather than a flat 100. Purely simulated — no real auth.
 */

import { Router } from 'express';
import { asyncRoute, authToken, delay, jitter, maybeFail, newUserId, pick, USERS } from '../lib/sim.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncRoute(async (req, res) => {
    await delay(jitter(30));
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({
        error: { code: 'validation_error', message: 'email and password are required' },
      });
    }
    // ~1% invalid-credentials — a realistic baseline error rate.
    if (maybeFail(0.01)) {
      return res.status(401).json({
        error: { code: 'invalid_credentials', message: 'invalid email or password' },
      });
    }
    return res.status(200).json({
      token: authToken(),
      userId: newUserId(),
      expiresIn: 3600,
    });
  }),
);

authRouter.post(
  '/refresh',
  asyncRoute(async (req, res) => {
    await delay(jitter(18));
    const { token } = (req.body ?? {}) as { token?: string };
    if (!token) {
      return res.status(400).json({
        error: { code: 'validation_error', message: 'token is required' },
      });
    }
    return res.status(200).json({ token: authToken(), expiresIn: 3600 });
  }),
);

authRouter.get(
  '/me',
  asyncRoute(async (req, res) => {
    await delay(jitter(16));
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({
        error: { code: 'unauthorized', message: 'missing or invalid bearer token' },
      });
    }
    const user = pick(USERS);
    return res.status(200).json({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  }),
);
