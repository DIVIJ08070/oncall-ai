import type { FastifyReply } from 'fastify';
import type { ApiError, ErrorCode } from '@oncall/shared';

/**
 * Standard error body (SPEC §7): `{ error: { code, message, details? } }`.
 * `code` is one of the SPEC §7 codes (`unauthorized`, `validation_error`, …).
 */
export function errorBody(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

/** Send a SPEC §7 error with the given HTTP status. */
export function sendError(
  reply: FastifyReply,
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): FastifyReply {
  return reply.code(status).send(errorBody(code, message, details));
}

/** Map an HTTP status to the closest SPEC §7 error code. */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'validation_error';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 429:
      return 'rate_limited';
    case 502:
    case 503:
    case 504:
      return 'upstream_error';
    default:
      return 'internal';
  }
}
