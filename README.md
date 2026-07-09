# OnCall AI

**An AI incident responder that watches a service's logs, detects incidents, finds
the root cause with a real Claude agent, and opens a GitHub pull request with the
fix — which a human reviews and merges before anything ships.**

OnCall AI ingests a customer app's logs over authenticated HTTPS, rolls them up
into health metrics, and runs a 15-second threshold detector that opens
**incidents** (with dedup). Each new incident auto-starts an **investigation**: a
Claude agentic loop, run through the **Claude Agent SDK** against the developer's
Claude Max **subscription** (no API key), using six read-only/PR tools to find the
root cause. The agent then authors a fix as a **real GitHub pull request** on a
demo "victim" repo. A human reviews and merges; GitHub Actions runs a deploy job;
the platform verifies recovery against live metrics and closes the incident. A
React dashboard shows service health, live logs, metric charts, an incident
timeline, a live investigation feed (SSE), and chat. Everything runs on one laptop.

---

## Contents

- [Architecture](#architecture)
- [The detect → investigate → fix → verify loop](#the-detect--investigate--fix--verify-loop)
- [Safety model](#safety-model)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Setup and run](#setup-and-run)
- [Demo flow](#demo-flow)
- [Agent authentication (Claude Max subscription, no API key)](#agent-authentication-claude-max-subscription-no-api-key)
- [Configuration reference](#configuration-reference)
- [Repository layout](#repository-layout)
- [Built (MVP)](#built-mvp)
- [Roadmap / out of scope](#roadmap--out-of-scope)
- [API reference](#api-reference)

---

## Architecture

Two repositories are involved:

- **Platform repo** — this monorepo (`~/Desktop/oncall-ai`). It hosts the ingest
  API, detection engine, agent, GitHub integration, and dashboard. It never
  receives PRs.
- **Customer / "victim" repo** — `GITHUB_OWNER/GITHUB_REPO`
  (default `DIVIJ08070/oncall-ai-victim`). A standalone mirror of `apps/victim`.
  Fixes target it, its GitHub Actions deploy on merge, and the agent's tools read
  its commits, diffs, and files.

```
customer app (apps/victim)
   │  @oncall/sdk middleware / tailer — non-blocking, fail-silent, outbound HTTPS
   ▼
POST /api/v1/ingest ──▶ log_events (SQLite)
                            │
     detection loop (15s) ◀─┴─ metric_samples (rolled up each tick)
            │ threshold breach + new fingerprint (deduped)
            ▼
        incidents (open) ──▶ InvestigationEngine  (live Claude Agent SDK | cached replay)
            │                       │  6 in-process SDK tools (5 read-only + create_fix_pr)
            │                       ▼
            │              real GitHub pull request on the customer repo
            │                       │  human reviews + merges
     merge poller (Octokit) ◀───────┘  GitHub Actions deploy.yml runs
            │ detects merged PR
            ▼
   heal local victim + recovery verifier ──▶ PR comment + incident resolved
            │
  SSE brokers ◀── steps / logs / metrics ──▶ React dashboard
```

The customer app ships logs with `@oncall/sdk` (an Express/Fastify middleware or a
file tailer). The platform authenticates each batch by per-customer ingest key,
stores the events, and computes rollups. The detection engine opens an incident on
a threshold breach, which auto-starts an investigation. The agent produces a root
cause and a pull request. Recovery is confirmed by polling for the merge and
sampling metrics after a local heal.

## The detect → investigate → fix → verify loop

```
 ┌──────────┐   threshold breach    ┌───────────────┐   6 tools + Claude    ┌──────────────┐
 │  DETECT  │ ────────────────────▶ │  INVESTIGATE  │ ────────────────────▶ │     FIX      │
 │ 15s loop │   opens an incident   │  agent loop   │   root cause +        │ create_fix_pr│
 └──────────┘                       └───────────────┘   evidence + conf.    └──────┬───────┘
      ▲                                                                            │ real PR
      │ incident resolved                                                          ▼
 ┌──────────┐   metrics recover    ┌───────────────┐   human merges       ┌──────────────┐
 │  VERIFY  │ ◀─────────────────── │ recovery window│ ◀────────────────── │ human review │
 │  poller  │   PR comment +       │  (heal victim) │   GitHub Actions     │  + merge     │
 └──────────┘   incident closed    └───────────────┘   deploy job runs    └──────────────┘
```

Incident status machine (SQLite `incidents.status`):

```
open ─(auto)→ investigating ─┬─ propose_fix → fix_proposed → awaiting_merge ─(merge poll)→ verifying ─┬─ recovered → resolved
                             └─ escalate    → escalated (terminal until a human acts)                 └─ not_recovered → stays open
transient auto-heal: metrics recover before any PR merges → resolved (self-recovered)
```

## Safety model

The agent can propose changes but can **never** apply them. Every guarantee below
is enforced in **code**, not in the prompt:

- **Sandboxed agent.** The Claude Agent SDK `query()` loop is configured with an
  `allowedTools` allowlist of exactly the six investigation tools plus the
  `submit_findings` control tool. The built-in filesystem, bash, and network tools
  are disallowed — the agent has no shell, no filesystem, and no arbitrary HTTP.
  Only these tools are callable.
- **Create-only pull requests, no merge path.** `create_fix_pr` is the only write
  tool. It uses only `git.createBlob` / `createTree` / `createCommit` /
  `createRef` (on a new branch) and `pulls.create`. The narrow GitHub client type
  the agent's write path is built on does not even expose `git.updateRef` on base,
  `git.deleteRef`, force-push, or `pulls.merge`. **Merging is physically absent
  from the codebase** — a human is the only actor who can merge.
- **Repo-pinned.** Owner and repo come only from `GITHUB_OWNER` / `GITHUB_REPO`.
  The Octokit facade is constructed pre-bound to that repo; no tool input carries
  an owner/repo field, so targeting a different repo is impossible by construction.
- **Branch guard.** `assertWritableBranch` throws if the target branch is empty,
  is the default branch, or is in `GITHUB_PROTECTED_BRANCHES` (default
  `main,master`). Fix branches are auto-generated: `oncall-ai/fix-<incidentId>-<rand6>`.
- **Confidence gate.** When `confidence < AGENT_CONFIDENCE_THRESHOLD` (default 0.6),
  `create_fix_pr` refuses and returns `{ escalate: true, reason }`. The agent must
  escalate to a human rather than open a PR it is unsure about.
- **Bounded tool outputs.** Every tool result is clamped to ≤ 12 KB of JSON;
  repetitive log lines are collapsed into `{ signature, count, sample }` groups.
  This bounds cost and latency.
- **No secrets to the model.** Tools receive their database/Octokit/config context
  by closure; tokens are never placed in tool inputs, tool outputs, or the prompt.
- **Least inbound access.** Ingestion is customer-initiated outbound HTTPS. The
  platform never connects into the customer app (the demo `/__control/*` heal is a
  local-only convenience for the single-laptop demo).

The result: OnCall AI can detect, diagnose, and *propose* a fix end-to-end
autonomously, but a human approves every change that reaches the default branch.

## Tech stack

| Layer | Choice |
|---|---|
| Language / runtime | TypeScript 5.5, Node.js ≥ 20.11 (ESM), one npm workspace |
| Platform server | Fastify 4 (SSE via raw reply) |
| Storage | SQLite via `better-sqlite3` (WAL, foreign keys on) |
| Validation | Zod (one schema source → API validation + SDK tool typing) |
| GitHub | Octokit (`@octokit/rest`) — real PRs, commits, diffs (no `gh` CLI) |
| Agent runtime | `@anthropic-ai/claude-agent-sdk` + `@anthropic-ai/claude-code`, subscription auth |
| Live streaming | Server-Sent Events (native `EventSource`) |
| Dashboard | React 18 + Vite 5 + Tailwind 3 + Recharts 2 |
| Tests | Vitest + Fastify `.inject()` |

## Prerequisites

- **Node.js ≥ 20.11** and npm.
- **A Claude Max subscription, logged in through Claude Code** for live
  investigations. `@anthropic-ai/claude-code` is installed as a project dependency,
  so the SDK authenticates through the subscription (`~/.claude.json`) with no
  `ANTHROPIC_API_KEY`. Without it, run in cached mode (see below).
- **A GitHub fine-grained Personal Access Token** scoped to the victim repo with
  **Contents: Read and write** and **Pull requests: Read and write** (the seed step
  also needs **Workflows: Read and write** to push the `.github/workflows/` files).
  Set it as `GITHUB_TOKEN`. Without a token the platform runs, but the merge poller
  is disabled and PRs fall back to a canned record in cached mode.
- **The customer / victim repo** (`GITHUB_OWNER/GITHUB_REPO`). For the demo it must
  exist on GitHub and be seeded once with the baseline + failure-mode commits (see
  the seed step below).
- (Optional) A GitHub OAuth App (`GITHUB_OAUTH_CLIENT_ID` / `..._SECRET`) for the
  onboarding sign-in flow. When unset, the onboarding sign-in button surfaces an
  "unavailable" state and read APIs stay open under `DEV_NO_AUTH`.

## Setup and run

### 1. Install and build

```bash
cd ~/Desktop/oncall-ai
cp .env.example .env      # then edit .env (see below)
npm install
npm run build             # tsc -b across the workspace
```

`.env.example` ships only the credentials a human must supply
(`GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `INGEST_API_KEY`, optional OAuth
and Slack, `PORT`, `DATABASE_URL`). **Every other setting has a built-in default in
`packages/server/src/config.ts`** — the full contract is in
[Configuration reference](#configuration-reference). For a first run, the settings
that matter are:

```bash
# .env
GITHUB_TOKEN=github_pat_...          # fine-grained PAT, Contents RW + PRs RW on the victim repo
GITHUB_OWNER=DIVIJ08070              # customer repo owner
GITHUB_REPO=oncall-ai-victim         # customer repo name
INGEST_API_KEY=dev-local-ingest-key  # the victim ships with this key
# ANTHROPIC_API_KEY stays empty — the agent uses your Claude Max subscription
```

### 2. Seed the customer and the victim repo

- **The demo customer** (with its ingest key and default service) is created
  automatically the first time the platform boots, keyed on `INGEST_API_KEY`. No
  separate command is needed for local ingest to work.
- **The victim repo git history** is seeded once with a script that mirrors
  `apps/victim` to `GITHUB_OWNER/GITHUB_REPO` and pushes a baseline commit plus one
  bad-deploy commit per failure mode (so the agent has real commits to diff and
  revert):

  ```bash
  npx tsx scripts/init-victim-repo.ts
  ```

  This writes `data/victim-manifest.json` (the mode → SHA map) and the correlated
  `deploys` rows. The seeded repo has `main = baseline → bad_deploy → slow_db →
  config_error`, with `.github/workflows/{ci,deploy}.yml` present at every commit.
  The token needs Contents + Workflows write for this push to succeed.

### 3. Start the stack

Three processes, typically three terminals:

```bash
# Terminal 1 — platform (Fastify, :3001)
npm run start -w @oncall/server
#   or, live-reload: npm run dev -w @oncall/server

# Terminal 2 — dashboard (Vite, :5173)
npm run dev -w @oncall/dashboard
#   open http://localhost:5173

# Terminal 3 — victim customer app (Express, :4000)
npm run dev -w oncall-ai-victim
```

The dashboard proxies `/api` to the platform base URL, so SSE and fetch work
same-origin in dev. Read APIs are open under `DEV_NO_AUTH=true` (the default), so
you do not need OAuth configured to use the dashboard.

To run everything against the live Claude agent, keep `AGENT_MODE=auto` (the
default) and stay signed in to Claude Code. To run fully offline, set
`AGENT_MODE=cached` — investigations replay from `packages/agent/cache/*.json` and
(when `GITHUB_TOKEN` is set) still open a real PR.

### 4. Drive an end-to-end run

With all three processes up:

```bash
npm run demo                              # default: bad_deploy scenario
npm run demo -- --scenario slow_db --rate 90
npm run demo -- --wait-for-merge          # pauses until you merge the PR, then verifies recovery
```

`scripts/demo.ts` talks only to the platform's demo control plane (the same
`POST /api/v1/demo/failure-mode` + `POST /api/v1/demo/traffic` seams the dashboard
DemoControl panel uses): it establishes a healthy baseline, flips to a failing mode
under traffic, waits for the detector to open an incident, reports the investigation
and PR, and (with `--wait-for-merge`) polls until recovery is confirmed.

### Tests

```bash
npm test                  # vitest across the workspace
```

## Demo flow

1. **Baseline.** The victim app runs healthy and ships one `info` log per request.
   The dashboard shows the `checkout-api` service healthy with a live log stream and
   metric charts.
2. **Break it.** Flip a failure mode from the dashboard's DemoControl panel (or via
   `scripts/demo.ts`): `bad_deploy` (null-ref 500s on `POST /api/checkout`),
   `slow_db` (2–4 s latency on `GET /api/reports`), or `config_error` (missing
   config throws on `GET /api/pricing`). The platform flips the victim and marks the
   mode's real bad commit as the current deploy.
3. **Detect.** Under traffic, within ~15 s the detection loop's error-rate (or p95
   latency) threshold trips and an incident opens (deduped by fingerprint).
4. **Investigate.** The incident auto-starts an investigation. The dashboard's
   investigation feed streams each step live over SSE: metrics → logs → recent
   deploys → deploy diff → file read → conclusion. The agent identifies the bad
   commit as the root cause.
5. **Fix.** The agent calls `create_fix_pr` with a revert of the bad commit. A real
   pull request opens on the victim repo with a full diagnostic report; GitHub
   Actions CI runs on it.
6. **Review and merge.** A human reviews the PR on GitHub and merges it. The deploy
   workflow runs on `main`.
7. **Verify.** The platform's merge poller detects the merge, heals the local victim
   (simulating the redeploy), samples metrics over a recovery window, comments the
   result on the PR, and marks the incident `resolved`.
8. **Chat / postmortem.** Ask the incident questions in the chat panel (read-only,
   grounded in the recorded evidence) and generate a postmortem draft.

## Agent authentication (Claude Max subscription, no API key)

The investigation agent runs the Claude Agent SDK `query()` loop and authenticates
through the developer's **logged-in Claude Code subscription** (`~/.claude.json`) —
there is **no `ANTHROPIC_API_KEY`**. `@anthropic-ai/claude-code` is a project
dependency so subscription auth works without the global `claude` binary on PATH.
`USE_CLAUDE_SUBSCRIPTION` defaults to `true`; `ANTHROPIC_API_KEY` is present in the
config only for compatibility and is unused (leave it empty). The model is
configurable via `AGENT_MODEL` (default `claude-sonnet-5`). When the subscription /
SDK is unreachable and `AGENT_MODE=auto`, the platform falls back to the
deterministic cached engine.

## Configuration reference

`.env` is git-ignored. The victim reads the `ONCALL_*` / `VICTIM_*` subset; the
platform reads the rest. Only the credentials are required — everything else
defaults. `packages/server/src/config.ts` is the source of truth.

| Var | Default | Component | Purpose |
|---|---|---|---|
| `USE_CLAUDE_SUBSCRIPTION` | `true` | agent | Use Claude Agent SDK subscription auth (no API key). |
| `ANTHROPIC_API_KEY` | *(empty, unused)* | agent | Not required; present only for compatibility. Leave empty. |
| `AGENT_MODEL` | `claude-sonnet-5` | agent | SDK `model` option. |
| `AGENT_MODE` | `auto` | agent | `auto` \| `live` \| `cached`. `auto` uses the live SDK when reachable, else cached. |
| `AGENT_MAX_ITERATIONS` | `10` | agent | SDK `maxTurns` cap. |
| `AGENT_CONFIDENCE_THRESHOLD` | `0.6` | agent | Below this, `create_fix_pr` refuses and the agent escalates. |
| `AGENT_COST_CAP_USD` | `0.25` | agent | Turn/token bound (marginal cost ≈ 0 under subscription). |
| `CACHE_REAL_PR` | `true` | agent | In cached mode, still open a real PR (when GitHub is reachable). |
| `GITHUB_TOKEN` | *(empty)* | github | Fine-grained PAT, Contents + PRs RW on the victim repo. Enables the merge poller and real PRs. |
| `GITHUB_OWNER` | `DIVIJ08070` | github | Customer repo owner (repo pinning). |
| `GITHUB_REPO` | `oncall-ai-victim` | github | Customer repo name. |
| `GITHUB_DEFAULT_BRANCH` | `main` | github | Base / protected branch. |
| `GITHUB_PROTECTED_BRANCHES` | `main,master` | github | Branch-guard denylist. |
| `GITHUB_OAUTH_CLIENT_ID` | *(empty)* | auth | OAuth sign-in. Login/callback return 503 when unset. |
| `GITHUB_OAUTH_CLIENT_SECRET` | *(empty)* | auth | OAuth sign-in secret. |
| `INGEST_API_KEY` | `dev-local-ingest-key` | ingest | Seed customer's ingest key (must match the victim's `ONCALL_API_KEY`). |
| `SLACK_WEBHOOK_URL` | *(empty)* | notify | Slack stub; empty → log-only (records a `notifications` row). |
| `PORT` | `3001` | server | Platform port. |
| `DATABASE_URL` | `./data/oncall.sqlite` | server | SQLite file (relative paths resolve to the server package cwd). |
| `PUBLIC_BASE_URL` | `http://localhost:3001` | server | OAuth callback base + advertised ingest URL. |
| `DASHBOARD_URL` | `http://localhost:5173` | server | CORS origin + post-login redirect. |
| `SESSION_SECRET` | `dev-secret-change-me` | auth | Signed session cookie secret. |
| `DEV_NO_AUTH` | `true` | server | Demo: read APIs open without a session. |
| `DETECTION_INTERVAL_MS` | `15000` | detection | Detection loop period. |
| `ERROR_RATE_THRESHOLD` | `0.2` | detection | Error-rate open threshold. |
| `MIN_REQUESTS_FOR_DETECTION` | `5` | detection | Noise floor before a threshold can trip. |
| `LATENCY_P95_THRESHOLD_MS` | `1000` | detection | p95 latency open threshold. |
| `SILENCE_WINDOW_MS` | `60000` | detection | Silence detector: no events for this long → open. |
| `RECOVERY_WINDOW_MS` | `60000` | detection | Post-merge recovery sampling window. |
| `MERGE_POLL_INTERVAL_MS` | `5000` | github | Merge poller period. |
| `VICTIM_PORT` | `4000` | victim | Victim server port. |
| `VICTIM_CONTROL_URL` | `http://localhost:4000` | server | Platform → victim heal / failure-mode switch. |
| `ONCALL_INGEST_URL` | `http://localhost:3001/api/v1/ingest` | victim | Victim → platform log shipping URL. |
| `ONCALL_API_KEY` | `dev-local-ingest-key` | victim | Must match `INGEST_API_KEY`. |

> Note: the shipped `.env.example` lists only the required credentials plus `PORT`
> and `DATABASE_URL`; the remaining keys above are optional overrides read by
> `config.ts` with the defaults shown.

## Repository layout

```
oncall-ai/
├─ package.json                 # npm workspaces root; scripts: build, test, seed, demo
├─ .env.example                 # credential template (subset of the full config)
├─ data/                        # SQLite file + victim-manifest.json (git-ignored)
├─ scripts/
│  ├─ init-victim-repo.ts       # mirror apps/victim → customer repo + seed commits
│  ├─ record-cache.ts           # record live investigations → packages/agent/cache/*.json
│  └─ demo.ts                   # end-to-end rehearsal harness + traffic generator
├─ packages/
│  ├─ shared/                   # @oncall/shared — types + Zod schemas (DTOs, tool I/O, SSE)
│  ├─ sdk/                      # @oncall/sdk — log shipper: client, middleware, tailer, CLI
│  ├─ agent/                    # @oncall/agent — engine (live | cached), 6 tools, guards, cache
│  ├─ server/                   # @oncall/server — Fastify platform (ingest, detection, github, sse)
│  └─ dashboard/                # @oncall/dashboard — React + Vite + Tailwind + Recharts
└─ apps/
   └─ victim/                   # demo customer app (3 failure modes), mirrored to the customer repo
```

## Built (MVP)

Delivered and QA-passed across 15 build chunks (C1–C15); see `CHANGELOG.md`:

- **Ingestion.** `POST /api/v1/ingest` with per-customer key auth (batches up to
  500 events); `@oncall/sdk` non-blocking fail-silent client, Express/Fastify
  middleware, file/stdout tailer, and `oncall-tail` CLI. SQLite storage of all log
  fields.
- **Metrics + detection.** Per-tick rollups (error rate, request volume, p50/p95/p99
  latency), a 15 s threshold loop with fingerprint dedup, the incident lifecycle
  state machine, and silence detection.
- **Agent + safety.** Six in-process SDK tools (`search_logs`, `get_metrics`,
  `get_recent_deploys`, `get_deploy_diff`, `read_file`, `create_fix_pr`) plus the
  `submit_findings` control tool; the `LiveClaudeEngine` (Claude Agent SDK loop,
  subscription auth) and a deterministic `CachedEngine`; code-enforced safety
  guards (repo pinning, branch guard, create-only, confidence gate) and 12 KB
  bounded outputs.
- **GitHub.** Real revert/patch pull requests via Octokit with a full diagnostic
  PR body; GitHub OAuth sign-in and repo selection; the integration snippet route;
  a merge poller with recovery verification and a PR result comment; the victim
  repo seed with CI and deploy workflows.
- **Dashboard.** Shell with service health, live log stream (SSE), Recharts metric
  charts, incident list + detail, the live investigation feed (SSE), the PR card,
  the read-only chat panel, the onboarding flow, and the DemoControl panel with a
  traffic generator.

Notable seams and stubs in this MVP:

- **Chat** answers with a deterministic, evidence-grounded responder by default
  (no LLM call); it is a seam into which a bounded read-only Claude tool loop can be
  injected.
- **Slack** notifications are a stub: log-only when `SLACK_WEBHOOK_URL` is empty,
  and every path records a `notifications` row (`sent` / `stubbed` / `failed`).
- **OAuth** login/callback return `503` until `GITHUB_OAUTH_CLIENT_ID/SECRET` are
  set; the dashboard uses `DEV_NO_AUTH` and the platform PAT for the demo.
- **Recovery** is driven by the merge poller (the optional GitHub webhook is not
  implemented). Because the victim runs locally, the platform heals it directly on
  merge detection to simulate the redeploy.
- The GitHub OAuth token is stored in plaintext in local SQLite for the demo.

## Roadmap / out of scope

Per the BRD (§5.2), the following are explicitly **not** built in this MVP:

- Multi-cloud / log-provider **pull** integrations (AWS CloudWatch, Datadog,
  Elasticsearch).
- **Live GitHub OAuth credentials** wired for production sign-in (the flow exists
  but ships with empty creds; the demo runs on `DEV_NO_AUTH` + the platform PAT).
- **Cloud deployment** of the platform and a truly cloud-deployed victim so GitHub
  Actions redeploys it (the MVP heals a local victim on merge detection).
- **Postgres** (or any server-based database) in place of local SQLite.
- **PII scrubbing**, data retention, at-rest encryption, and SOC2 — including
  encrypting the stored OAuth token.
- Kubernetes / infrastructure remediation, multi-tenant accounts / teams / roles /
  billing, production GitHub App distribution, fully autonomous remediation without
  a human merge, mobile apps, and WebSockets (SSE only).

## API reference

The full HTTP API — every `/api/v1` route, the six agent tools and their
bounded-output contracts, and the SSE event types — is documented in
[`docs/API.md`](docs/API.md).
