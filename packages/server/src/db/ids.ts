import { monotonicFactory } from 'ulid';

/**
 * ULID id helpers with type prefixes (SPEC §8: "IDs are string ULIDs with a
 * type prefix, e.g. `inc_...`").
 *
 * A prefixed id is `<prefix>_<ULID>` where the ULID is a 26-char Crockford
 * base32 string that is lexicographically sortable by creation time. The
 * `metric_samples` table is the only one that uses an INTEGER AUTOINCREMENT PK
 * and therefore has no helper here.
 *
 * Ids are minted through a single process-wide **monotonic** factory. The bare
 * `ulid()` re-rolls its 80-bit random component on every call, so two ids
 * created in the same millisecond sort in random relative order. The monotonic
 * factory instead increments that component for same-millisecond calls, making
 * output *strictly increasing* in mint order. That is what lets `ORDER BY
 * created_at, id` be a correct insertion-order tiebreaker for rows that share a
 * `created_at` (BUG-006: chat_messages same-ms ordering).
 */
const monotonicUlid = monotonicFactory();

/** Canonical prefix per table (SPEC §8). */
export const ID_PREFIX = {
  customer: 'cus',
  user: 'usr',
  service: 'svc',
  log_event: 'log',
  incident: 'inc',
  session: 'ses',
  step: 'stp',
  deploy: 'dep',
  pull_request: 'pr',
  chat_message: 'msg',
  notification: 'ntf',
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

/** Build a prefixed ULID. `seedTime` is exposed for deterministic tests. */
export function newId(prefix: IdPrefix, seedTime?: number): string {
  return `${prefix}_${monotonicUlid(seedTime)}`;
}

/** Return the prefix of an id (everything before the first `_`), or null. */
export function prefixOf(id: string): string | null {
  const i = id.indexOf('_');
  return i <= 0 ? null : id.slice(0, i);
}

/** Type guard: does `id` carry the expected prefix? */
export function hasPrefix(id: string, prefix: IdPrefix): boolean {
  return typeof id === 'string' && id.startsWith(`${prefix}_`);
}

/* ── Named constructors (readability at call sites) ─────────────────────── */

export const newCustomerId = (t?: number): string => newId(ID_PREFIX.customer, t);
export const newUserId = (t?: number): string => newId(ID_PREFIX.user, t);
export const newServiceId = (t?: number): string => newId(ID_PREFIX.service, t);
export const newLogEventId = (t?: number): string => newId(ID_PREFIX.log_event, t);
export const newIncidentId = (t?: number): string => newId(ID_PREFIX.incident, t);
export const newSessionId = (t?: number): string => newId(ID_PREFIX.session, t);
export const newStepId = (t?: number): string => newId(ID_PREFIX.step, t);
export const newDeployId = (t?: number): string => newId(ID_PREFIX.deploy, t);
export const newPullRequestId = (t?: number): string =>
  newId(ID_PREFIX.pull_request, t);
export const newChatMessageId = (t?: number): string =>
  newId(ID_PREFIX.chat_message, t);
export const newNotificationId = (t?: number): string =>
  newId(ID_PREFIX.notification, t);
