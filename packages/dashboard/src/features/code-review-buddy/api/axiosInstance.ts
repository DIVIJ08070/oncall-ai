import axios from 'axios';

/** Normalized shape every failed request rejects with. */
export interface ApiError {
  message: string;
  status?: number;
}

/**
 * Shared axios instance for Code Review Buddy.
 *
 * Timeout is deliberately generous (120s): repo scans clone + review an entire
 * repository through the model and routinely take well over a minute.
 */
export const api = axios.create({
  baseURL: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '',
  timeout: 120000,
});

/**
 * Normalize every failure to `{ message, status? }`. The Fastify server wraps
 * errors in an `{ error: { code, message } }` envelope; fall back to a plain
 * `message` field, then the transport error, then a generic string.
 */
api.interceptors.response.use(
  (response) => response,
  (err: unknown) => {
    let message = 'Request failed';
    let status: number | undefined;

    if (axios.isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { code?: string; message?: string }; message?: string }
        | undefined;
      message = data?.error?.message ?? data?.message ?? err.message ?? 'Request failed';
      status = err.response?.status;
    } else if (err instanceof Error) {
      message = err.message;
    }

    const apiError: ApiError = { message, status };
    return Promise.reject(apiError);
  },
);

/** Extract a human-readable message from a rejected request (stores use this). */
export function getErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const { message } = err as { message: unknown };
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'Request failed';
}
