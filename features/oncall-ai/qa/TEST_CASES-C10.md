# TEST CASES — C10 Read/Stream APIs (SPEC §7)

> Derived from SPEC §7 (API contracts) + §6 (dashboard bindings) BEFORE reading the C10
> implementation. Base path `/api/v1`. Conventions: JSON bodies; timestamps epoch ms;
> error body `{ "error": { "code", "message", "details" } }`; SSE frames
> `event: <type>\ndata: <json>\n\n` + `:heartbeat` comment every 15s.

## Error envelope (all non-2xx)
Codes: `unauthorized` `forbidden` `not_found` `validation_error` `rate_limited` `upstream_error` `internal`.

| ID | Requirement | Input / action | Expected |
|---|---|---|---|
| **§7.2 GET /services** |
| TC-01 | services list shape | `GET /services` | `200 { services:[{name,health,error_rate,p95_ms,req_per_min,last_event_at,active_incident_id}] }` |
| TC-02 | health enum | seed healthy + down/silent svc | each `health ∈ healthy\|degraded\|down\|silent` |
| TC-03 | active_incident_id link | svc with open incident | that svc's `active_incident_id` = the incident id; healthy svc → `null` |
| TC-04 | empty state | no services | `200 { services: [] }` |
| **§7.2 GET /metrics** |
| TC-05 | metrics snapshot shape | `GET /metrics?service=X&window_sec=900&resolution_sec=15` | `200 { service, window_sec, resolution_sec, current:{error_rate,req_count,p50_ms,p95_ms,p99_ms}, baseline:{error_rate,p95_ms}, series:[{ts,error_rate,req_count,p50_ms,p95_ms,p99_ms}] }` |
| TC-06 | series cap | many buckets | `series.length ≤ 240` |
| TC-07 | unknown service → 404 | `GET /metrics?service=nope` | `404 { error:{code:"not_found"} }` |
| TC-08 | missing/invalid service param → 400 | `GET /metrics` (no service) | `400 { error:{code:"validation_error"} }` |
| TC-09 | defaults | `GET /metrics?service=X` (no window/res) | `200`, window_sec=900, resolution_sec=15 defaults applied |
| **§7.2b GET /logs** |
| TC-10 | logs list shape | `GET /logs?service=X&limit=100` | `200 { events:[LogEvent...], next_before:<int\|null> }` |
| TC-11 | limit cap ≤500 | `GET /logs?limit=999` | limit clamped ≤500 (not error, or 400) — events ≤500 |
| TC-12 | filters | `GET /logs?service=X&level=error&since=&until=` | only matching events returned |
| TC-13 | pagination cursor | `GET /logs?limit=N` then `next_before` | `next_before` usable to page older events |
| **§7.2b GET /logs/stream (SSE)** |
| TC-14 | SSE content-type + framing | `GET /logs/stream?service=X` | `200`, `content-type: text/event-stream`, frames `event: log\ndata: <LogEvent JSON>\n\n` |
| TC-15 | heartbeat | hold stream ≥ heartbeat interval | `:heartbeat` comment line emitted |
| TC-16 | live publish | ingest a new log while subscribed | subscriber receives `log` event for it |
| **§7.3 GET /incidents** |
| TC-17 | incidents list shape | `GET /incidents` | `200 { incidents:[IncidentSummary...] }` |
| TC-18 | status filter | `GET /incidents?status=open` | only open incidents |
| TC-19 | service filter + limit | `GET /incidents?service=X&limit=50` | filtered; ≤ limit |
| **§7.3 GET /incidents/:id (full DTO)** |
| TC-20 | full detail DTO keys | `GET /incidents/:id` | `200 { incident, session, steps, pull_request, timeline }` (all 5 keys) |
| TC-21 | incident sub-DTO | — | `incident` has id,service,status,detector,title,fingerprint,observed_value,threshold_value,opened_at,first_error_at,resolved_at,root_cause,confidence |
| TC-22 | session sub-DTO | — | `session` has id,status,mode,model,iterations,cost_usd,root_cause,confidence |
| TC-23 | steps array | — | `steps:[InvestigationStep...]` ordered by seq; each has seq,type + type-appropriate fields |
| TC-24 | pull_request sub-DTO | incident with PR | `pull_request` has number,url,kind,state,verification_status,branch,base,head_sha |
| TC-25 | timeline | — | `timeline:[{ts,kind,label}]`, kind ∈ detected\|investigating\|pr_opened\|merged\|verifying\|resolved\|escalated |
| TC-26 | unknown id → 404 | `GET /incidents/inc_nope` | `404 not_found` |
| TC-27 | nullable sub-objects | incident w/o session/PR | `session`/`pull_request` null (or absent) gracefully, not a 500 |
| **§7.3 POST /incidents/:id/investigate** |
| TC-28 | manual (re)trigger 202 | `POST /incidents/:id/investigate` | `202 { session_id:"ses_..." }` |
| TC-29 | unknown incident → 404 | `POST /incidents/nope/investigate` | `404 not_found` |
| **§7.3 GET /incidents/:id/feed (SSE)** |
| TC-30 | feed SSE framing | `GET /incidents/:id/feed` | `200 text/event-stream`; events: session_started, step, pr_created, conclusion, session_completed, error, heartbeat |
| TC-31 | session_started payload | — | `{session_id, mode, model}` |
| TC-32 | step payload | — | `{seq, type, tool_name?, tool_input?, tool_output?, content?, ts}` |
| TC-33 | conclusion payload | — | `{root_cause, confidence, decision}` |
| TC-34 | session_completed payload | — | `{status, cost_usd, iterations}` |
| TC-35 | replay-then-live for late subscriber | subscribe after steps persisted | first receives REPLAY of persisted steps, THEN live |
| TC-36 | seq-dedup | replay + live overlap | no duplicate seq delivered (dedup by seq) |
| **§7.4 POST /incidents/:id/chat** |
| TC-37 | chat response shape | `POST /incidents/:id/chat {message}` | `200 { message:{ role:"assistant", content, evidence:[{type,tool,ref}] } }` |
| TC-38 | read-only grounding | chat message | responder grounded in incident evidence; READ-ONLY (never create_fix_pr / no writes) |
| TC-39 | missing message → 400 | `POST /incidents/:id/chat {}` | `400 validation_error` |
| TC-40 | unknown incident → 404 | `POST /incidents/nope/chat` | `404 not_found` |
| TC-41 | persists chat_messages | after chat | user + assistant rows persisted (§8 chat_messages) |
| **§7.4 GET /incidents/:id/chat/stream (SSE)** |
| TC-42 | chat token stream | `GET /incidents/:id/chat/stream` | `200 text/event-stream`; events `token`, `done` |
| **§7.4 postmortem** |
| TC-43 | POST postmortem 201 | `POST /incidents/:id/postmortem` | `201 { postmortem:"# Postmortem...\n" }` (markdown) + stored on incident |
| TC-44 | GET stored draft | `GET /incidents/:id/postmortem` after POST | `200 { postmortem }` |
| TC-45 | GET before generate → 404 | `GET /incidents/:id/postmortem` (none) | `404 not_found` |
| TC-46 | unknown incident → 404 | `POST /incidents/nope/postmortem` | `404 not_found` |
| **§7.8 health** |
| TC-47 | health | `GET /health` | `200 { status:"ok" }` |
| **FR-17 Slack stub / notifications** |
| TC-48 | Slack stub notify | incident opened / notify path | `notifications` row `channel=slack status=sent\|stubbed` (empty webhook → stubbed/log-only) |
| **Cross-cutting** |
| TC-49 | base path | all routes under `/api/v1` (health at `/health`) | mounted at correct paths |
| TC-50 | error envelope shape | any 4xx | body = `{ error:{ code, message, details? } }` |
| TC-51 | end-to-end persistence (real boot) | ingest→detect→incident→auto investigation | `investigation_sessions` + `investigation_steps` persist to SQLite; detail DTO reflects them |
