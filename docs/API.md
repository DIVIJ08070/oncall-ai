# OnCall AI — API Reference

HTTP API for the OnCall AI platform server. This reference is verified against the
implemented Fastify routes (`packages/server/src/routes/`), the agent tools
(`packages/agent/src/tools/`), and the shared Zod contracts (`packages/shared/src/`).
Where the implementation differs from the spec, the difference is noted inline.

- **Base path:** all application routes are under `/api/v1`. The liveness probe is
  the single exception (`GET /health`).
- **Bodies:** JSON. Timestamps are epoch **milliseconds** (integers) unless noted.
- **Auth:** ingestion uses the `x-ingest-key` header; read and management routes use
  the session cookie. Under `DEV_NO_AUTH=true` (the default) read routes resolve to
  the seed customer without a session. When `DEV_NO_AUTH=false` and no session is
  present, read routes return `401 unauthorized`.

### Error body

All non-2xx responses use:

```json
{ "error": { "code": "string", "message": "string", "details": {} } }
```

Codes in use: `unauthorized`, `forbidden`, `not_found`, `validation_error`,
`rate_limited`, `upstream_error`, `internal`.

### SSE framing

Server-Sent Events streams emit `event: <type>\ndata: <json>\n\n` frames and a
`:heartbeat` comment line as keep-alive. Consume with the native `EventSource`.

---

## 1. Ingestion

### `POST /api/v1/ingest`

Auth: header `x-ingest-key: <ingest_api_key>`. Accepts a batch of 1–500 events.

Request:

```json
{ "events": [
  { "timestamp": 1752000000000, "service": "checkout-api", "level": "error",
    "message": "Cannot read properties of undefined (reading 'name')",
    "stack": "TypeError: ...\n  at ...", "endpoint": "/api/checkout",
    "method": "POST", "status": 500, "latency_ms": 42 }
] }
```

Field rules: `service`, `level`, `message` are required; `level ∈ debug|info|warn|error`;
other fields are nullable. `timestamp` defaults to server receive time if omitted.

Responses:

- `202 { "accepted": 1, "rejected": 0, "errors": [] }` — the batch envelope was valid
  (individual invalid events are rejected per-index without failing the request).
- `401 unauthorized` — missing or invalid `x-ingest-key`.
- `400 validation_error` — malformed batch envelope (empty, or > 500 events).

Side effects: writes `log_events`, updates the service's `last_event_at`, and
publishes to the `logs/<service>` SSE topic.

---

## 2. Services and metrics

### `GET /api/v1/services`

Auth: session (or seed customer under `DEV_NO_AUTH`). Returns per-service health for
the dashboard.

```json
{ "services": [
  { "name": "checkout-api", "health": "healthy|degraded|down|silent",
    "error_rate": 0.0, "p95_ms": 120, "req_per_min": 54,
    "last_event_at": 1752000000000, "active_incident_id": null } ] }
```

### `GET /api/v1/metrics`

Query: `service` (required), `window_sec` (default 900, ≤ 3600), `resolution_sec`
(default 15).

```json
{ "service": "checkout-api", "window_sec": 900, "resolution_sec": 15,
  "current":  { "error_rate": 0.0, "req_count": 812, "p50_ms": 40, "p95_ms": 120, "p99_ms": 260 },
  "baseline": { "error_rate": 0.01, "p95_ms": 130 },
  "series":   [ { "ts": 1752000000000, "error_rate": 0.0, "req_count": 13, "p50_ms": 38, "p95_ms": 110, "p99_ms": 210 } ] }
```

`series` is capped to 240 points. Responses: `200`; `404 not_found` if the service is
unknown; `400 validation_error` on a malformed query.

---

## 3. Logs

### `GET /api/v1/logs`

Query: `service`, `level`, `since`, `until`, `limit` (default 100, ≤ 500). Returns
newest-first, keyset-paginated history.

```json
{ "events": [ { "timestamp": 1752, "service": "checkout-api", "level": "error", "message": "..." } ],
  "next_before": 1752000000000 }
```

`next_before` is the oldest timestamp in a full page, or `null` when there is no more
history. The internal `customer_id` is stripped from wire events.

### `GET /api/v1/logs/stream` (SSE)

Query: `service` (optional; omit to stream every service for the customer). Events:
`log` (`data` = a `LogEvent`) and `heartbeat`.

---

## 4. Incidents and investigation feed

### `GET /api/v1/incidents`

Query: `status`, `service`, `limit` (default 50). Returns `{ "incidents": [IncidentSummary, ...] }`.

### `GET /api/v1/incidents/:id`

Full incident detail. `404 not_found` when the incident is unknown or not owned by the
caller's customer.

```json
{ "incident": { "id": "inc_...", "service": "checkout-api", "status": "resolved",
    "detector": "error_rate", "title": "Error-rate spike on checkout-api",
    "fingerprint": "...", "observed_value": 0.87, "threshold_value": 0.2,
    "opened_at": 1752, "first_error_at": 1752, "resolved_at": 1752,
    "root_cause": "Null deref introduced by deploy abc1234", "confidence": 0.92 },
  "session": { "id": "ses_...", "status": "completed", "mode": "live",
    "model": "claude-sonnet-5", "iterations": 4, "cost_usd": 0.06,
    "root_cause": "...", "confidence": 0.92 },
  "steps": [ /* InvestigationStep... */ ],
  "pull_request": { "number": 7, "url": "https://github.com/...", "kind": "revert",
    "state": "merged", "verification_status": "recovered",
    "branch": "oncall-ai/fix-inc_...-a1b2c3", "base": "main", "head_sha": "def5678" },
  "timeline": [ { "ts": 1752, "kind": "detected|investigating|pr_opened|merged|verifying|resolved|escalated", "label": "..." } ] }
```

The `pull_request` sub-DTO carries all eight fields
(`number, url, kind, state, verification_status, branch, base, head_sha`).

### `POST /api/v1/incidents/:id/investigate`

Manually (re)trigger an investigation (normally automatic on incident open).
Responses: `202 { "session_id": "ses_..." }`; `404 not_found`; `503 upstream_error`
when no investigation engine is available.

### `GET /api/v1/incidents/:id/feed` (SSE)

Live investigation feed. A late subscriber first receives `session_started`, then a
`replay` of persisted steps, then live frames (with seq-dedup so a replayed step is
not re-sent live).

| Event | Data |
|---|---|
| `session_started` | `{ session_id, mode, model }` |
| `replay` | `{ steps: [InvestigationStep, ...] }` |
| `step` | `InvestigationStep` — `{ id, session_id, seq, type, tool_name?, tool_input?, tool_output?, content?, created_at }` |
| `pr_created` | `{ number, url, kind }` |
| `conclusion` | `{ root_cause, confidence, decision }` |
| `session_completed` | `{ status, cost_usd, iterations }` |
| `error` | `{ message }` |
| `heartbeat` | `{ ts }` |

Step `type ∈ thought | tool_call | tool_result | conclusion | error`.

---

## 5. Chat and postmortem

### `POST /api/v1/incidents/:id/chat`

Body `{ "message": "Why this commit?" }`. Runs a **read-only**, evidence-grounded
answer over the incident's persisted investigation evidence. Persists both the user
message and the assistant reply to `chat_messages`.

```json
{ "message": { "role": "assistant", "content": "...",
    "evidence": [ { "type": "tool", "tool": "get_deploy_diff", "ref": "abc1234" } ] } }
```

> Implementation note: the default responder is deterministic (no LLM call) — it
> composes a factual answer from the recorded root cause, session findings, tool
> steps, suspect deploy, and PR. It is a seam: a bounded read-only Claude tool loop
> (the six tools minus `create_fix_pr`) can be injected without changing the route.

Responses: `200`; `400 validation_error` (empty message); `404 not_found`.

### `GET /api/v1/incidents/:id/chat/stream` (SSE)

Query: `message` (required, non-empty). Streams the same answer as tokens. Events:
`token` (`{ text }`) then `done` (`{ content }`). Evidence is not included on the
token stream — use `POST /chat` when evidence chips are needed.

### `POST /api/v1/incidents/:id/postmortem`

Generates and stores a markdown postmortem on the incident.
`201 { "postmortem": "# Postmortem...\n" }`; `404 not_found`.

### `GET /api/v1/incidents/:id/postmortem`

Returns the stored draft. `200 { "postmortem": "..." }`; `404 not_found` when the
incident is unknown or no draft has been generated yet.

---

## 6. GitHub OAuth and repo selection

OAuth credentials may be empty. When they are, `login` and `callback` return `503`;
read paths remain open under `DEV_NO_AUTH`.

### `GET /api/v1/auth/github/login`

`302` to GitHub authorize (sets a signed `state` cookie); `503 upstream_error` when
OAuth is not configured.

### `GET /api/v1/auth/github/callback`

Query: `code`, `state`. Validates state, exchanges the code, upserts the user (linked
to the seed customer), issues a signed session cookie, and `302`-redirects to
`DASHBOARD_URL/onboarding`. Errors: `503` (OAuth unconfigured), `400` (missing
code/state), `401` (state mismatch or denial), `502` (token exchange / user fetch
failure).

### `GET /api/v1/auth/me`

`200 { "user": { "id", "github_login", "avatar_url" } }`; `401 unauthorized`.

### `POST /api/v1/auth/logout`

`204`. Clears the session cookie when present.

### `GET /api/v1/repos`

Auth: the session GitHub token, or the platform PAT under `DEV_NO_AUTH`. Lists
accessible repos; falls back to the pinned victim repo when the token cannot
list-for-user.

```json
{ "repos": [ { "owner": "...", "repo": "...", "default_branch": "main", "private": false } ] }
```

`401 unauthorized` (no token); `502 upstream_error` (list failed).

### `POST /api/v1/repos/select`

Body `{ "owner", "repo" }`. Binds `customers.github_owner/github_repo/default_branch`.

```json
{ "customer": { "id", "name", "github_owner", "github_repo", "default_branch" } }
```

`200` on success; `400 validation_error` (bad body); `401 unauthorized`;
`404 not_found` (repo not found); `422 validation_error` when the repo lacks Contents
+ Pull requests write access.

---

## 7. Integration snippet

### `GET /api/v1/integration-snippet`

```json
{ "ingest_url": "http://localhost:3001/api/v1/ingest",
  "ingest_api_key": "dev-local-ingest-key",
  "middleware_snippet": "import { oncall } from '@oncall/sdk'; app.use(oncall({ apiKey: '...', service: 'checkout-api' }))",
  "tailer_snippet": "npx oncall-tail --file ./app.log --service checkout-api --key ..." }
```

The `ingest_api_key` is the calling customer's key (or the configured key under
`DEV_NO_AUTH`).

---

## 8. Demo control plane

Drives the victim app for the demo. Requires a resolved customer (the seed customer
under `DEV_NO_AUTH`) and a running victim app.

### `POST /api/v1/demo/failure-mode`

Body `{ "mode": "healthy|bad_deploy|slow_db|config_error" }`. Flips the victim's
in-memory failure switch and marks the mode's real bad commit as the current deploy
(so `get_recent_deploys` / `get_deploy_diff` return correlated data).

Responses: `200 { "mode", "deployed_sha" }`; `400 validation_error` (bad mode);
`401 unauthorized` (no customer); `502 upstream_error` (victim unreachable).

### `GET /api/v1/demo/state`

Proxies the victim's current mode + deployed SHA (CORS-clean for the dashboard
readout). `200 { "mode", "deployed_sha" }`; `401`; `502`.

### `POST /api/v1/demo/traffic`

Server-side traffic burst at the victim (so the browser can drive load without CORS).
Body `{ "count"?: number (1–60, default 10), "target"?: "checkout|reports|pricing|mix" (default "mix") }`.
`200 { "sent", "ok", "failed", "target" }`; `401`.

> The victim also exposes its own control endpoints directly:
> `POST http://localhost:4000/__control/failure-mode { mode } → 200 { mode }` and
> `GET http://localhost:4000/__control/state → 200 { mode, deployed_sha }`.

---

## 9. Health

### `GET /health`

`200 { "status": "ok" }`. Not under `/api/v1`.

> The optional GitHub webhook (`POST /api/v1/github/webhook`) described in the spec
> is **not implemented** — recovery is driven by the merge poller.

---

## 10. Agent tools (Claude Agent SDK)

The investigation agent may call only these tools (plus `submit_findings`); the
allowlist is enforced by the SDK sandbox. Inputs and outputs are Zod-typed in
`packages/shared/src/tools.ts`. Every output passes through the bounded-output rules:
**any single tool result is clamped to ≤ 12 KB of JSON**, and repetitive log lines
are collapsed into `{ signature, count, sample }` groups.

### 1. `search_logs` — read `log_events`

```
input:  { service?, level?, query?, endpoint?, status?, since?, until?, limit? (≤50, default 30) }
output: { total_matched, returned, truncated,
          events:   [ { ts, level, message, endpoint, status, latency_ms, stack_excerpt } ],
          patterns: [ { signature, count, sample } ] }
```

Caps: ≤ 50 event rows; `stack_excerpt` ≤ 1200 chars; ≤ 50 pattern groups (top-N by
count). When matches exceed the returned rows, `patterns` summarizes the remainder by
signature. The whole envelope is re-clamped to 12 KB as a backstop.

### 2. `get_metrics` — read `metric_samples`

```
input:  { service, window_sec? (≤3600, default 900), resolution_sec? (default 15) }
output: { service, window_sec,
          current:  { error_rate, req_count, p50_ms, p95_ms, p99_ms },
          baseline: { error_rate, p95_ms },
          series:   [ { ts, error_rate, req_count, p95_ms } ] }
```

`series` ≤ 60 points.

### 3. `get_recent_deploys` — real git log via Octokit

```
input:  { limit? (≤20, default 10) }
output: { deploys: [ { sha, short_sha, message_first_line, author, committed_at, is_current } ] }
```

Reads `repos.listCommits` on the pinned repo's default branch, enriched with the
current-deploy flag. ≤ 20 commits.

### 4. `get_deploy_diff` — real diff via Octokit

```
input:  { sha }  |  { base, head }
output: { base, head, total_files, total_additions, total_deletions, truncated,
          files: [ { path, status, additions, deletions, patch_excerpt } ] }
```

Caps: ≤ 20 files; each `patch_excerpt` ≤ 100 lines / 4000 chars; total diff payload
re-clamped to the 12 KB result cap.

### 5. `read_file` — real file via Octokit

```
input:  { path, ref? (default = default branch), start_line?, end_line? }
output: { path, ref, total_lines, returned_lines, truncated, content }
```

Caps: ≤ 400 lines, and `content` is byte-clamped so the serialized result stays ≤ 12 KB.
Paths are normalized; `..` and absolute paths are rejected (stays within the repo).

### 6. `create_fix_pr` — the only write tool

```
input:  { kind: "revert"|"patch", confidence: number, root_cause: string,
          title: string, body: string,     // body = the full diagnostic report
          revert_sha?: string,             // required when kind = "revert"
          files?: [ { path, content } ] }  // required when kind = "patch"
output (success):  { pr_number, url, branch, head_sha, base }
output (refusal):  { escalate: true, reason }
```

Safety, all enforced in code (see the README safety model): repo-pinned, writable-
branch guarded, create-only (no merge/force-push path), and gated by
`AGENT_CONFIDENCE_THRESHOLD` — below the threshold the tool returns the refusal
payload instead of opening a PR. For a revert, the tool fetches the target commit and
its parent and restores each changed file to its parent content on a new branch.

### Control tool: `submit_findings`

Terminates the loop with a structured conclusion; performs no repo action.

```
input:  { root_cause, evidence: [ { type, ref } ], confidence, decision: "propose_fix"|"escalate" }
output: { acknowledged: true }
```

Calling it writes the session's root cause / confidence / decision and emits the
`conclusion` feed event.

---

## 11. SSE event types (summary)

| Stream | Route | Events |
|---|---|---|
| Logs | `GET /api/v1/logs/stream` | `log`, `heartbeat` |
| Investigation feed | `GET /api/v1/incidents/:id/feed` | `session_started`, `replay`, `step`, `pr_created`, `conclusion`, `session_completed`, `error`, `heartbeat` |
| Chat | `GET /api/v1/incidents/:id/chat/stream` | `token`, `done`, `heartbeat` |

Canonical event-name list: `log`, `heartbeat`, `replay`, `session_started`, `step`,
`pr_created`, `conclusion`, `session_completed`, `error`, `token`, `done`
(`packages/shared/src/sse.ts`).
