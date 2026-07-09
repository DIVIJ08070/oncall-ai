/**
 * `@oncall/sdk` — zero-friction, non-blocking log shipper for OnCall AI
 * (FR-02, NFR-04). Public surface:
 *
 *  - {@link OncallClient} / {@link createClient} — batched, fail-silent client.
 *  - {@link oncall} / {@link oncallFastify} — Express / Fastify telemetry middleware.
 *  - {@link tailFile} / {@link tailStream} — file / stdout tailer (backs `oncall-tail`).
 */
export {
  OncallClient,
  createClient,
  MAX_EVENTS_PER_REQUEST,
  type OncallClientOptions,
  type OncallEventInput,
  type OncallWireEvent,
} from './client.js';

export {
  oncall,
  oncallFastify,
  type OncallMiddlewareOptions,
  type OncallExpressMiddleware,
} from './middleware.js';

export {
  tailFile,
  tailStream,
  parseLine,
  inferLevel,
  type TailerOptions,
  type TailHandle,
} from './tailer.js';
