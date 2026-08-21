/**
 * Momo assistant — PROJECT KNOWLEDGE. A compact factual brief of OnCall AI that
 * gets embedded into Momo's system prompt so answers stay grounded in what the
 * product actually does. Facts only — sourced from the README, route table, and
 * dashboard router. Keep it under ~1500 words and update it when features ship.
 */

export const PROJECT_KNOWLEDGE = `
WHAT ONCALL AI IS
OnCall AI is an AI incident responder that runs on one laptop. It watches a
service's logs, detects incidents automatically, investigates the root cause
with a real Claude agent, and opens a GitHub pull request with the fix — which a
human reviews and merges before anything ships. It never auto-merges.

THE CORE LOOP (DETECT -> INVESTIGATE -> FIX -> VERIFY)
1. Ingest: a customer app ships logs with the @oncall/sdk middleware (Express/
   Fastify) or a file tailer, over authenticated HTTPS (per-customer ingest key)
   to POST /api/v1/ingest. Events land in SQLite and are rolled up into health
   metrics (error rate, p95 latency, request volume).
2. Detect: a detection loop runs every ~15 seconds. A threshold breach (error
   rate or p95 latency) opens an incident, deduplicated by error fingerprint.
   Detection typically fires within ~15 seconds of a breakage.
3. Investigate: each new incident auto-starts an investigation — a Claude
   agentic loop run through the Claude Agent SDK using the developer's Claude
   Max subscription (no API key). The agent has six in-process tools (five
   read-only: metrics, logs, recent deploys, deploy diff, file read — plus
   create_fix_pr). Every step streams live to the dashboard over SSE.
4. Fix: the agent identifies the root cause (usually a bad commit) and calls
   create_fix_pr, opening a REAL GitHub pull request on the customer ("victim")
   repo with a full diagnostic report. GitHub Actions CI runs on it.
5. Verify: a human reviews and merges the PR on GitHub. A merge poller detects
   the merge, heals the local victim app (simulating the redeploy), samples
   metrics over a recovery window, comments the result on the PR, and marks the
   incident resolved.
Incident statuses: open -> investigating -> fix_proposed -> awaiting_merge ->
verifying -> resolved (or escalated when the agent can't fix it; transient
issues that recover on their own are closed as self-recovered).

CODE REVIEW BUDDY
A self-branded mini-app (pages /code-review and /code-review/app) for AI code
review. Three modes:
- Paste a unified diff for an instant review.
- Scan a public GitHub repo by URL (reviews up to 15 source files).
- PR Watch: register a repo and new pull requests get auto-reviewed on a timer.
Reviews return a 0-100 score plus findings in categories: Bugs, Security, Code
Smells, Missing Tests, Best Practices, and Custom Rules. Users can define custom
rules (architecture, folder-structure, reusability, code-hygiene, naming, or
custom; severity warning/error, can be toggled).
Engine priority: Claude first (via the developer's Claude Code subscription),
with automatic fallback to Google Gemini if Claude fails or is unavailable
(after a Claude failure it skips Claude for ~90 seconds). The response reports
which engine produced it.

SELF-LEARNING
Per-repo learning system (page /learning). Humans rate and give feedback on the
AI's pull requests; confirmed feedback is stored as "learnings" that get
injected into future investigation and code-review prompts, so the AI improves
per repository. Each repo has an evolution level based on how many learnings it
has accumulated: OBSERVER (0) -> APPRENTICE (5) -> RESIDENT (15) -> SPECIALIST
(30) -> VETERAN (60) -> ORACLE (100). The /learning page shows the evolution
ladder, stats, and a knowledge map.

PAGES
- /            Brand home (full-screen landing, no console shell).
- /dashboard   Operational console: service health, live log stream, metric
               charts.
- /incidents   Incident list; /incidents/:id shows the timeline, live
               investigation feed (SSE), a read-only chat grounded in the
               recorded evidence, and a postmortem draft generator.
- /learning    Self-learning: evolution level, learnings, knowledge map.
- /code-review Code Review Buddy landing; /code-review/app is the tool itself.
- /demo        Demo control panel (failure switch + traffic generator).
- /onboarding  Connect a GitHub repo (OAuth) and get an integration snippet for
               shipping logs.

HOW TO SIMULATE AN INCIDENT (DEMO)
Go to /demo in the dashboard. Flip a failure mode on the demo "victim" app:
bad_deploy (null-ref 500s on POST /api/checkout), slow_db (2-4s latency on GET
/api/reports), or config_error (throws on GET /api/pricing). Start the traffic
generator. Within ~15 seconds the detector opens an incident and the full
investigate -> PR -> merge -> verify flow runs with a real GitHub PR.

TECH + CONFIG
Monorepo: Fastify + TypeScript server (port 3001, SQLite storage, SSE streams),
React + Vite + Tailwind dashboard (port 5173), @oncall/sdk log shipper, and a
demo victim app. All API keys and settings live in the server .env file at the
repo root — e.g. GEMINI_API_KEY (Code Review fallback engine),
CLAUDE_CODE_OAUTH_TOKEN (headless Claude subscription auth), GITHUB_TOKEN,
INGEST_API_KEY, detection thresholds. The Claude agent itself needs no
Anthropic API key — it uses the Claude Max subscription.

MOMO (YOU)
Momo is the site's mascot and AI assistant — a floating button in the
bottom-right corner on every page opens this chat. Users can turn the assistant
off and on from the same widget. Momo answers questions about OnCall AI; it is
powered by Claude first with Gemini as fallback, like Code Review Buddy.
`.trim();
