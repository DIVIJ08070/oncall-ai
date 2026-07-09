import { OncallClient, createClient, type OncallClientOptions } from './client.js';

/**
 * Express / Fastify telemetry middleware (SPEC §3, §12; FR-02).
 *
 * Mirrors the victim's inlined `telemetry.ts` (the exact integration snippet):
 *  - one `info` event per completed request with `endpoint,method,status,latency_ms`;
 *  - one `error` event per thrown/handled failure with `message,stack` (+ the
 *    request fields for correlation).
 *
 * All shipping goes through the batched, fail-silent {@link OncallClient} so the
 * host request path is never blocked or thrown into (NFR-04).
 */

/** Options mirror the client; `client` lets callers share one batch pipeline. */
export type OncallMiddlewareOptions = OncallClientOptions & {
  /** Reuse an existing client instead of constructing one. */
  client?: OncallClient;
};

/* ── minimal structural Express types (no `express` dependency) ──────────── */
interface ExpressReq {
  method?: string;
  originalUrl?: string;
  url?: string;
  baseUrl?: string;
  path?: string;
  route?: { path?: string };
}
interface ExpressRes {
  statusCode?: number;
  on(event: string, listener: () => void): unknown;
}
type ExpressNext = (err?: unknown) => void;
type ExpressRequestHandler = (
  req: ExpressReq,
  res: ExpressRes,
  next: ExpressNext,
) => void;
type ExpressErrorHandler = (
  err: unknown,
  req: ExpressReq,
  res: ExpressRes,
  next: ExpressNext,
) => void;

/** Express handler augmented with the shared client + a paired error handler. */
export type OncallExpressMiddleware = ExpressRequestHandler & {
  client: OncallClient;
  errorHandler: ExpressErrorHandler;
};

function endpointOf(req: ExpressReq): string {
  const raw = req.originalUrl ?? req.url ?? req.path ?? '';
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

function errStack(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) return { message: err.message, stack: err.stack ?? null };
  if (typeof err === 'string') return { message: err, stack: null };
  try {
    return { message: JSON.stringify(err), stack: null };
  } catch {
    return { message: String(err), stack: null };
  }
}

/**
 * Express middleware (the FR-02 snippet: `app.use(oncall({ apiKey, service }))`).
 * The returned function also carries `.client` and `.errorHandler`; register the
 * latter last (`app.use(mw.errorHandler)`) to capture thrown errors with stacks.
 */
export function oncall(options: OncallMiddlewareOptions): OncallExpressMiddleware {
  const client = options.client ?? createClient(options);

  const requestLogger: ExpressRequestHandler = (req, res, next) => {
    const start = Date.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      client.capture({
        level: 'info',
        message: `${req.method ?? 'GET'} ${endpointOf(req)}`,
        endpoint: endpointOf(req),
        method: req.method ?? null,
        status: res.statusCode ?? null,
        latency_ms: Date.now() - start,
      });
    };
    res.on('finish', finish);
    res.on('close', finish);
    next();
  };

  const errorHandler: ExpressErrorHandler = (err, req, res, next) => {
    const { message, stack } = errStack(err);
    client.capture({
      level: 'error',
      message,
      stack,
      endpoint: endpointOf(req),
      method: req.method ?? null,
      status: res.statusCode && res.statusCode >= 400 ? res.statusCode : 500,
    });
    next(err);
  };

  const mw = requestLogger as OncallExpressMiddleware;
  mw.client = client;
  mw.errorHandler = errorHandler;
  return mw;
}

/* ── Fastify plugin ──────────────────────────────────────────────────────── */

/** Minimal structural Fastify types (no `fastify` dependency in the SDK). */
interface FastifyLikeRequest {
  method?: string;
  url?: string;
  routeOptions?: { url?: string };
}
interface FastifyLikeReply {
  statusCode?: number;
  elapsedTime?: number;
}
interface FastifyLikeInstance {
  addHook(name: 'onResponse', fn: (req: FastifyLikeRequest, reply: FastifyLikeReply) => void): void;
  addHook(
    name: 'onError',
    fn: (req: FastifyLikeRequest, reply: FastifyLikeReply, error: unknown) => void,
  ): void;
  decorate?(name: string, value: unknown): void;
}

/**
 * Fastify plugin form. Register with `app.register(oncallFastify, { apiKey, service })`.
 * Emits the same info/error telemetry via the shared batched client and decorates
 * the instance with `oncall` (the {@link OncallClient}).
 */
export function oncallFastify(
  fastify: FastifyLikeInstance,
  options: OncallMiddlewareOptions,
  done: (err?: Error) => void,
): void {
  const client = options.client ?? createClient(options);

  fastify.addHook('onResponse', (req, reply) => {
    const endpoint = (req.url ?? '').split('?')[0];
    client.capture({
      level: 'info',
      message: `${req.method ?? 'GET'} ${endpoint}`,
      endpoint,
      method: req.method ?? null,
      status: reply.statusCode ?? null,
      latency_ms:
        typeof reply.elapsedTime === 'number' ? Math.round(reply.elapsedTime) : null,
    });
  });

  fastify.addHook('onError', (req, reply, error) => {
    const { message, stack } = errStack(error);
    client.capture({
      level: 'error',
      message,
      stack,
      endpoint: (req.url ?? '').split('?')[0],
      method: req.method ?? null,
      status: reply.statusCode && reply.statusCode >= 400 ? reply.statusCode : 500,
    });
  });

  try {
    fastify.decorate?.('oncall', client);
  } catch {
    // decoration is best-effort (already decorated / unsupported) — ignore.
  }
  done();
}
