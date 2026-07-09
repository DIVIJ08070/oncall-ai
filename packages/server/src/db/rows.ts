import type { EvidenceRef, LogEvent } from '@oncall/shared';

/**
 * DAO-level row types + codecs (SPEC §8).
 *
 * Most tables map 1:1 onto an `@oncall/shared` type (`Incident`, `Session`,
 * `Step`, `MetricSample`, `DeployRef`, `PullRequestRec`) and those DAOs reuse
 * the shared type directly. The types below cover the columns the public API
 * DTOs intentionally omit — e.g. `customers.ingest_api_key`, `users.access_token`,
 * `log_events.customer_id`, and the `services` / `chat_messages` / `notifications`
 * rows, which have no over-the-wire shape.
 */

/* ── customers ──────────────────────────────────────────────────────────── */
export interface CustomerRow {
  id: string;
  name: string;
  ingest_api_key: string;
  github_owner: string | null;
  github_repo: string | null;
  default_branch: string;
  created_at: number;
}

/* ── users ──────────────────────────────────────────────────────────────── */
export interface UserRow {
  id: string;
  github_user_id: number;
  github_login: string;
  avatar_url: string | null;
  /** GitHub OAuth token; plaintext in MVP (OQ-1 / NFR-08 roadmap). */
  access_token: string | null;
  customer_id: string | null;
  created_at: number;
}

/* ── services ───────────────────────────────────────────────────────────── */
export interface ServiceRow {
  id: string;
  customer_id: string;
  name: string;
  first_event_at: number | null;
  last_event_at: number | null;
}

/* ── log_events ─────────────────────────────────────────────────────────── */
/** Stored log row = the API `LogEvent` shape plus its owning `customer_id`. */
export type LogEventRow = LogEvent & { customer_id: string };

/* ── chat_messages ──────────────────────────────────────────────────────── */
export type ChatRole = 'user' | 'assistant';
export interface ChatMessageRow {
  id: string;
  incident_id: string | null;
  role: ChatRole;
  content: string;
  evidence: EvidenceRef[] | null;
  created_at: number;
}

/* ── notifications ──────────────────────────────────────────────────────── */
export type NotificationChannel = 'slack';
export type NotificationStatus = 'sent' | 'stubbed' | 'failed';
export interface NotificationRow {
  id: string;
  incident_id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  payload: unknown;
  created_at: number;
}

/* ── codecs (JSON columns + SQLite 0/1 booleans) ────────────────────────── */

/** Serialize a value for a JSON TEXT column (`null`/`undefined` → SQL NULL). */
export function toJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

/** Parse a JSON TEXT column back to `T` (SQL NULL → `null`). */
export function fromJson<T>(text: string | null): T | null {
  if (text === null || text === undefined) return null;
  return JSON.parse(text) as T;
}

/** SQLite has no boolean type: booleans persist as INTEGER 0/1. */
export function boolToInt(b: boolean): 0 | 1 {
  return b ? 1 : 0;
}

export function intToBool(n: number): boolean {
  return n !== 0;
}
