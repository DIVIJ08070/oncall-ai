import type {
  Confidence,
  Decision,
  DeployRef,
  Incident,
  LogEvent,
  LogLevel,
  MetricSample,
  PrKind,
  PullRequestRec,
  Step,
} from '@oncall/shared';

/**
 * Ports for the agent tool layer (SPEC §9 `ports.ts`).
 *
 * The agent is a **lower** layer than the platform server: it defines the
 * interfaces (ports) it needs and the server provides adapters. This inverts the
 * dependency so `@oncall/server` (C7/C9/C10) can depend on `@oncall/agent`
 * without a cycle — the agent never imports `@oncall/server`.
 *
 * `ToolDb` / `ToolConfig` are **structural** ports: the server's concrete
 * `OncallDb` (with the full DAO set) and `Config` satisfy them by having *more*
 * than these interfaces require, so `const db: ToolDb = realOncallDb` typechecks.
 */

/* ── StepSink — transparency seam (NFR-06) ──────────────────────────────────
 * The investigation loop (C7 `stream.ts`) maps SDK messages → persisted steps +
 * SSE. Tools only emit the two high-signal control events; everything is
 * optional so a tool runs identically against a no-op sink (tests/chat). */
export interface StepSink {
  /** Persist/emit a raw step (used by the loop; optional for tool-only runs). */
  step?(step: Step): void | Promise<void>;
  /** `create_fix_pr` succeeded — surfaces the `pr_created` SSE frame (§7.3). */
  prCreated?(data: {
    number: number;
    url: string;
    kind: PrKind;
  }): void | Promise<void>;
  /** `submit_findings` called — surfaces the `conclusion` SSE frame (§7.3). */
  conclusion?(data: {
    root_cause: string;
    confidence: Confidence;
    decision: Decision;
  }): void | Promise<void>;
}

/** A sink that records nothing (default for tool-only / test runs). */
export const NOOP_SINK: StepSink = {};

/* ── DB port (satisfied structurally by @oncall/server `Daos`) ────────────── */

/**
 * DB port results may be sync or async: the server's dual-driver DAO layer is
 * async (`Promise`-returning), while test fakes may stay sync. Call sites in
 * the tool layer always `await`.
 */
export type MaybePromise<T> = T | Promise<T>;

/** A stored log row = the API `LogEvent` plus its owning `customer_id`. */
export interface ToolLogRow extends LogEvent {
  customer_id?: string;
}

/** Log query the tool layer issues (mirrors the server `LogEventsDao.query`). */
export interface ToolLogQuery {
  customer_id?: string;
  service?: string;
  level?: LogLevel;
  since?: number;
  until?: number;
  /** Keyset pagination: only rows with `timestamp < before`. */
  before?: number;
  limit?: number;
}

/** The `services` fields the tool layer reads (server `ServiceRow` is a superset). */
export interface ToolServiceRow {
  name: string;
  first_event_at: number | null;
  last_event_at: number | null;
}

/**
 * The `api_performance_samples` fields `get_api_performance` reads — the latest
 * derived performance profile per (service, endpoint). The server
 * `ApiPerformanceSampleRow` is a superset (extra window/latency columns), so it
 * satisfies this narrower port structurally.
 */
export interface ToolApiPerformanceRow {
  service_name: string;
  endpoint: string;
  method: string;
  window_start: number;
  window_end: number;
  p95_latency_ms: number;
  error_rate: number;
  performance_score: number;
  risk_score: number;
}

/**
 * The `risk_states` fields `get_api_performance` reads — the durable per-endpoint
 * escalation status plus the serialized latest prediction. The server
 * `RiskStateRow` is a superset, so it satisfies this narrower port structurally.
 */
export interface ToolRiskStateRow {
  service_name: string;
  endpoint: string;
  status: string;
  current_risk_score: number | null;
  /** JSON-serialized `RiskPrediction` (probability + minutesToBreach live here). */
  prediction_details: string | null;
}

/** PR row the write tool persists (mirrors server `CreatePullRequestInput`). */
export interface ToolCreatePrInput {
  incident_id: string;
  customer_id: string;
  github_pr_number: number;
  github_pr_id: number;
  branch: string;
  base_branch: string;
  title: string;
  url: string;
  kind: PrKind;
  diagnostic_report: string;
  head_sha: string;
}

/** Incident fields the write tool patches (server `IncidentPatch` is a superset). */
export type ToolIncidentPatch = Partial<
  Pick<Incident, 'status' | 'root_cause' | 'confidence' | 'pr_id' | 'suspect_deploy_sha'>
>;

/**
 * The DAO surface the six tools touch. Deliberately narrow — the write path
 * has exactly one create method (`pullRequests.create`) and one incident patch;
 * there is no delete/merge DAO method reachable from a tool.
 */
export interface ToolDb {
  dao: {
    logEvents: {
      query(q: ToolLogQuery): MaybePromise<ToolLogRow[]>;
    };
    metricSamples: {
      latestForService(
        customerId: string,
        service: string,
      ): MaybePromise<MetricSample | null>;
      seriesForService(
        customerId: string,
        service: string,
        sinceTs: number,
        limit?: number,
      ): MaybePromise<MetricSample[]>;
    };
    deploys: {
      getBySha(customerId: string, sha: string): MaybePromise<DeployRef | null>;
      getCurrent(customerId: string): MaybePromise<DeployRef | null>;
      listRecent(customerId: string, limit?: number): MaybePromise<DeployRef[]>;
    };
    incidents: {
      update(id: string, patch: ToolIncidentPatch): MaybePromise<Incident | null>;
    };
    pullRequests: {
      create(input: ToolCreatePrInput): MaybePromise<PullRequestRec>;
    };
    services: {
      getByName(
        customerId: string,
        name: string,
      ): MaybePromise<ToolServiceRow | null>;
    };
    apiPerformance: {
      /**
       * The most-recent sample for every (service, endpoint) — one row per
       * endpoint. `customerScope`, when given, restricts to those service names.
       */
      latestPerService(
        customerScope?: readonly string[],
      ): MaybePromise<ToolApiPerformanceRow[]>;
    };
    riskStates: {
      /** Every tracked risk state (one row per (service, endpoint)). */
      listAll(): MaybePromise<ToolRiskStateRow[]>;
    };
  };
}

/* ── Config port (satisfied structurally by @oncall/server `Config`) ──────── */

/** GitHub pinning + branch-guard config (repo/owner come from here ONLY, §9). */
export interface ToolGithubConfig {
  owner: string;
  repo: string;
  defaultBranch: string;
  protectedBranches: string[];
  token?: string;
}

export interface ToolConfig {
  github: ToolGithubConfig;
  agent: {
    /** FR-13 escalation gate for `create_fix_pr`. */
    confidenceThreshold: number;
  };
}

/** The customer the investigation runs for (only `id` is needed by the tools). */
export interface ToolCustomer {
  id: string;
}

/* ── Pinned GitHub facade (implemented in guards.ts) ──────────────────────── */

export interface PinnedCommitSummary {
  sha: string;
  short_sha: string;
  message_first_line: string;
  author: string;
  committed_at: number;
}

export interface PinnedDiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** Unified-diff hunk text (may be absent for binaries/lockfiles). */
  patch: string | null;
}

export interface PinnedCommitDetail {
  sha: string;
  parents: string[];
  message: string;
  author: string;
  committed_at: number;
  additions: number;
  deletions: number;
  files: PinnedDiffFile[];
}

export interface PinnedCompare {
  base_sha: string;
  head_sha: string;
  files: PinnedDiffFile[];
  total_additions: number;
  total_deletions: number;
}

export interface PinnedFileContent {
  path: string;
  ref: string;
  /** UTF-8 decoded file content. */
  content: string;
}

export interface PinnedPrResult {
  number: number;
  id: number;
  url: string;
  branch: string;
  base: string;
  head_sha: string;
}

/**
 * The repo-pinned GitHub client the tools receive (`ctx.octokit`). Owner/repo
 * are baked in at construction (SPEC §9 guard #1) — **no method accepts an
 * owner/repo argument**, so referencing another repo is impossible. The write
 * surface is **create-only**: `openRevertPr`/`openPatchPr` are the only mutating
 * methods and they contain no merge/force/base-write path (SPEC §9 guards #2–4).
 */
export interface PinnedGitHub {
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;

  /* reads */
  listCommits(opts: { limit: number; ref?: string }): Promise<PinnedCommitSummary[]>;
  getCommitDiff(sha: string): Promise<PinnedCommitDetail>;
  compare(base: string, head: string): Promise<PinnedCompare>;
  getFile(path: string, ref?: string): Promise<PinnedFileContent>;

  /* the ONLY writes — both open a PR from a NEW branch onto the default base */
  openRevertPr(args: {
    revertSha: string;
    branch: string;
    title: string;
    body: string;
  }): Promise<PinnedPrResult>;
  openPatchPr(args: {
    files: { path: string; content: string }[];
    branch: string;
    title: string;
    body: string;
  }): Promise<PinnedPrResult>;
}

/* ── ToolContext — passed to every tool by closure (SPEC §9) ──────────────── */

/**
 * Everything a tool needs, injected once per investigation. **Secrets are never
 * placed in tool inputs/outputs or the prompt** (NFR-02) — the token lives only
 * inside the pre-bound `octokit` facade and `config.github.token`.
 */
export interface ToolContext {
  db: ToolDb;
  octokit: PinnedGitHub;
  config: ToolConfig;
  customer: ToolCustomer;
  incident: Incident;
  sink: StepSink;
}
