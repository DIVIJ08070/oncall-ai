# Changelog

All notable changes to OnCall AI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-10

Initial MVP release: the full detect → investigate → fix → verify loop on one
laptop, built and QA-passed across 15 chunks (C1–C15).

### Added

**Foundation**

- npm workspaces monorepo scaffold with a shared `@oncall/shared` package (types
  and Zod schemas for DTOs, tool I/O, and SSE events) and an environment config
  loader with defaults for the full settings contract. (C1)
- SQLite data layer via `better-sqlite3`: all tables, indexes, DAOs, and
  idempotent migrations (customers, users, services, log events, metric samples,
  incidents, investigation sessions and steps, deploys, pull requests, chat
  messages, notifications). (C2)

**Ingestion**

- `POST /api/v1/ingest` with per-customer `x-ingest-key` authentication, batch
  validation (up to 500 events), and per-index event rejection. (C3)
- `@oncall/sdk`: a non-blocking, fail-silent batched client; Express/Fastify
  request + error telemetry middleware; a file/stdout tailer; and the `oncall-tail`
  CLI. (C3)

**Metrics and detection**

- Per-tick metric rollups (error rate, request volume, p50/p95/p99 latency) written
  to `metric_samples`. (C5)
- A 15-second threshold detection loop with error-rate, latency, and silence
  detectors; fingerprint-based dedup; and the incident lifecycle state machine. (C5)

**Agent and safety**

- Six in-process Claude Agent SDK tools — `search_logs`, `get_metrics`,
  `get_recent_deploys`, `get_deploy_diff`, `read_file`, and the write-only
  `create_fix_pr` — plus the `submit_findings` control tool, registered through
  `createSdkMcpServer`. (C6)
- Code-enforced safety guards: repo pinning, writable-branch guard, create-only PR
  write path (no merge/force-push code path), the FR-13 confidence gate, and 12 KB
  bounded tool outputs with repetitive-error summarization. (C6)
- `LiveClaudeEngine`: the Claude Agent SDK `query()` loop over the allowlisted
  tools using Claude Max subscription auth (no API key), with `submit_findings`
  termination, the max-iterations and cost caps, and escalation. (C7)
- `CachedEngine`: deterministic step replay behind the same engine interface, a
  `record-cache` recorder, and a real-PR fallback so the demo survives an offline
  agent. (C8)

**GitHub integration**

- Real revert and patch pull requests via Octokit, with a full diagnostic PR body
  (summary, timeline, root cause, evidence, proposed fix, risk assessment). (C6/C9)
- GitHub OAuth sign-in (`/auth/github/login`, `/callback`, `/me`, `/logout`), repo
  listing and selection with a permission check, and the integration-snippet route.
  (C9)
- A merge poller with post-merge recovery verification, a local victim heal, and a
  recovery-result comment on the PR. (C9)
- The victim repo seed script (`init-victim-repo.ts`): mirrors `apps/victim` to the
  customer repo with a baseline commit plus one bad-deploy commit per failure mode,
  writes `data/victim-manifest.json`, and includes CI and deploy GitHub Actions
  workflows. (C4)

**Victim demo app**

- An Express "customer" app with vendored, fail-silent telemetry and three
  switchable failure modes (null-ref `bad_deploy`, `slow_db`, `config_error`) plus
  the `/__control/*` demo switch. (C4)

**Read/stream API and dashboard**

- Read and stream routes: services health, metrics, logs + logs SSE, incidents list
  and detail, the investigation feed SSE (replay-then-live), chat and chat token
  stream, postmortem generation, and the Slack notification stub. (C10)
- React + Vite + Tailwind + Recharts dashboard: shell, service health, live log
  stream, and metric charts. (C12)
- Incident timeline, incident detail, the live investigation feed, the PR card, and
  the chat panel. (C13)
- The onboarding flow (GitHub sign-in → repo select → integration snippet →
  connected state). (C14)
- The DemoControl panel (failure-mode switch + traffic generator), the platform
  demo control plane (`/api/v1/demo/*`), and the `scripts/demo.ts` rehearsal
  harness. (C15)

### Fixed

Defects found and resolved during QA of the chunks above:

- Deterministic intra-millisecond ordering for `chat_messages` (monotonic ULIDs +
  stable tiebreaker). (BUG-006)
- `search_logs` `patterns[]` and `read_file` `content` now respect the 12 KB global
  tool-output cap over the whole serialized result. (BUG-007, BUG-008)
- `GET /api/v1/incidents/:id` `pull_request` DTO exposes the full field set
  including `branch`, `base`, and `head_sha`. (BUG-009)
- Error-rate chart breach dots render only on breaching points; log level tags are
  legible (rendered in ink, not the raw status hue). (BUG-010, BUG-011)
- Dashboard dark-theme contrast raised to WCAG AA on raised surfaces for accent and
  muted text; the LIVE pulse indicator is limited to investigating incidents; the
  demo failure-mode response schema field renamed to `deployed_sha`. (BUG-012,
  BUG-013, BUG-014, BUG-015)
- Accessibility contrast fixes to the design tokens for muted and accent text on the
  light theme. (BUG-001, BUG-002)

### Known limitations

- Chat uses a deterministic, evidence-grounded responder by default (no LLM call).
- Slack notifications are a stub (log-only when no webhook is configured).
- GitHub OAuth login/callback return `503` until OAuth credentials are configured;
  the demo runs under `DEV_NO_AUTH` with the platform PAT.
- Recovery is driven by the merge poller; the optional GitHub webhook is not
  implemented. The local victim is healed directly on merge detection.
- The GitHub OAuth access token is stored in plaintext in local SQLite.

[0.1.0]: https://github.com/DIVIJ08070/oncall-ai/releases/tag/v0.1.0
