import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@oncall/shared';

/** `GET /health` (SPEC §7.8) → `200 { status: "ok" }`. */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', (): HealthResponse => ({ status: 'ok' }));
}
