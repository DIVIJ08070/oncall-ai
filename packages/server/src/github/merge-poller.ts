import type { Incident, PullRequestRec } from '@oncall/shared';
import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';
import type { Broker } from '../sse/broker.js';
import { type Clock, systemClock } from '../detection/clock.js';
import {
  beginVerifying,
  escalateIncident,
  resolveIncident,
} from '../detection/lifecycle.js';
import {
  createMetricsRecoveryVerifier,
  type RecoveryVerifier,
} from '../detection/recovery.js';
import { incidentsTopic, type DetectionLogger } from '../detection/seams.js';
import { rollupWindow, type Rollup } from '../metrics/rollup.js';
import { currentRange } from '../metrics/windows.js';

/**
 * Merge poller + recovery verifier (SPEC §10.5, FR-12).
 *
 * Polls `pulls.get` for each `awaiting_merge` PR via Octokit. On merge it:
 *   1. records a `deploys` row (`source=merge`, `is_current=1`) for the merge SHA;
 *   2. **heals the LOCAL victim** — POSTs victim `/__control/failure-mode {healthy}`
 *      (Actions can't redeploy a laptop — §11/OQ-2), simulating the fixed deploy;
 *   3. moves the incident `awaiting_merge → verifying` and opens a recovery window.
 * Then, each poll, it drives every `verifying` incident through the **C5 recovery
 * seam** (`createMetricsRecoveryVerifier`): sustained health ≥ 30 s → `recovered`
 * → resolve incident + PR comment + `verification_status=recovered`; window
 * expiry → `not_recovered` → re-escalate + PR comment.
 *
 * **Ownership:** this poller owns the whole recovery transition. When the C10
 * detection loop is started alongside it, construct that engine with
 * `recoveryVerifier: null` so recovery is driven from exactly one place.
 *
 * Time is read only through an injected `Clock` and metrics through an injectable
 * `sampleRollup`, so `poll()` is fully deterministic for tests (no wall-clock,
 * no live DB required).
 */

/* ── Narrow Octokit surface (read + comment only — never merges) ──────────── */

export interface MergePollerCommit {
  sha: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
    committer?: { date?: string } | null;
  };
  author?: { login?: string } | null;
}

export interface MergePollerPull {
  merged: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  state: string;
}

/**
 * The **only** GitHub verbs the poller may use. `pulls.merge` is intentionally
 * absent (merging is human-only, NFR-03) — the poller reads merge state and
 * writes a result comment, nothing more.
 */
export interface MergePollerOctokit {
  rest: {
    pulls: {
      get(p: {
        owner: string;
        repo: string;
        pull_number: number;
      }): Promise<{ data: MergePollerPull }>;
    };
    issues: {
      createComment(p: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
      }): Promise<{ data: { id: number } }>;
    };
    repos: {
      getCommit(p: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: MergePollerCommit }>;
    };
  };
}

/** Local-victim healer (SPEC §10.5 step 2). */
export interface VictimHealer {
  heal(): Promise<void>;
}

/** Default healer: POST victim `/__control/failure-mode {mode:"healthy"}`. */
export function createVictimHealer(config: Config, log?: DetectionLogger): VictimHealer {
  const url = `${config.victim.controlUrl.replace(/\/+$/, '')}/__control/failure-mode`;
  return {
    async heal() {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'healthy' }),
        });
      } catch (err) {
        // Healing is best-effort; a victim that's already down/offline must not
        // break the recovery flow (the metrics-driven verifier is the source of
        // truth for whether recovery actually held).
        log?.('[merge-poller] victim heal failed', err);
      }
    },
  };
}

/** Sample the trailing-window rollup for a service (recovery evaluation input). */
export type SampleRollup = (
  customerId: string,
  service: string,
  now: number,
) => Rollup;

export interface MergePollerOptions {
  db: OncallDb;
  config: Config;
  octokit: MergePollerOctokit;
  clock?: Clock;
  broker?: Broker;
  healer?: VictimHealer;
  /** Recovery verifier (C5 seam); a fresh metrics verifier by default. */
  verifier?: RecoveryVerifier;
  /** Metrics source for recovery evaluation (defaults to a live DB rollup). */
  sampleRollup?: SampleRollup;
  logger?: DetectionLogger;
}

export interface MergePollResult {
  now: number;
  merged: Incident[];
  resolved: Incident[];
  escalated: Incident[];
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export class MergePoller {
  private readonly db: OncallDb;
  private readonly config: Config;
  private readonly octokit: MergePollerOctokit;
  private readonly clock: Clock;
  private readonly broker?: Broker;
  private readonly healer: VictimHealer;
  private readonly verifier: RecoveryVerifier;
  private readonly sample: SampleRollup;
  private readonly log: DetectionLogger;

  private timer?: ReturnType<typeof setInterval>;
  private polling = false;

  constructor(opts: MergePollerOptions) {
    this.db = opts.db;
    this.config = opts.config;
    this.octokit = opts.octokit;
    this.clock = opts.clock ?? systemClock;
    this.broker = opts.broker;
    this.log = opts.logger ?? (() => {});
    this.healer = opts.healer ?? createVictimHealer(this.config, this.log);
    this.verifier = opts.verifier ?? createMetricsRecoveryVerifier(this.config);
    this.sample =
      opts.sampleRollup ??
      ((customerId, service, now) => {
        const { from, to } = currentRange(now);
        return rollupWindow(this.db.raw, customerId, service, from, to);
      });
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Start the `MERGE_POLL_INTERVAL_MS` loop (SPEC §10.5). Idempotent. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.polling) return; // never overlap async polls
      this.polling = true;
      void this.poll()
        .catch((err) => this.log('[merge-poller] poll error', err))
        .finally(() => {
          this.polling = false;
        });
    }, this.config.detection.mergePollIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log('[merge-poller] loop started', {
      intervalMs: this.config.detection.mergePollIntervalMs,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.log('[merge-poller] loop stopped');
    }
  }

  /** Run one poll pass (merge scan + recovery-window evaluation). Deterministic. */
  async poll(): Promise<MergePollResult> {
    const now = this.clock.now();
    const result: MergePollResult = { now, merged: [], resolved: [], escalated: [] };

    for (const customer of this.db.dao.customers.list()) {
      // Phase 1 — detect merges of PRs whose incident is awaiting_merge.
      for (const inc of this.db.dao.incidents.list({
        customer_id: customer.id,
        status: 'awaiting_merge',
      })) {
        await this.checkForMerge(customer.id, inc, now, result);
      }
      // Phase 2 — drive verifying incidents through the recovery window.
      for (const inc of this.db.dao.incidents.list({
        customer_id: customer.id,
        status: 'verifying',
      })) {
        this.evaluateRecovery(customer.id, inc, now, result);
      }
    }
    return result;
  }

  /** Phase 1: poll `pulls.get`; on merge, record deploy + heal + enter verifying. */
  private async checkForMerge(
    customerId: string,
    inc: Incident,
    now: number,
    result: MergePollResult,
  ): Promise<void> {
    const pr = this.db.dao.pullRequests.getByIncident(inc.id);
    if (!pr) return;

    let data: MergePollerPull;
    try {
      const res = await this.octokit.rest.pulls.get({
        owner: this.config.github.owner,
        repo: this.config.github.repo,
        pull_number: pr.github_pr_number,
      });
      data = res.data;
    } catch (err) {
      this.log('[merge-poller] pulls.get failed', { pr: pr.github_pr_number, err });
      return;
    }

    if (data.state === 'closed' && !data.merged) {
      // PR closed without merging → record closed; leave incident for humans.
      this.db.dao.pullRequests.update(pr.id, { state: 'closed' });
      return;
    }
    if (!data.merged) return; // still open — nothing to do yet.

    const mergeSha = data.merge_commit_sha ?? pr.head_sha;
    const mergedAt = data.merged_at ? Date.parse(data.merged_at) : now;

    await this.recordMergeDeploy(customerId, pr, mergeSha, mergedAt);
    this.db.dao.pullRequests.update(pr.id, {
      state: 'merged',
      merged_at: Number.isNaN(mergedAt) ? now : mergedAt,
      head_sha: mergeSha,
    });

    // Simulate the customer redeploy of the fixed code on the local victim.
    await this.healer.heal();

    // Enter the recovery window (SPEC §10.5 step 3). The just-verified incident is
    // picked up by Phase 2 of this same poll, which starts its sustained-health clock.
    const verifying = beginVerifying(this.db.dao.incidents, inc.id);
    this.verifier.begin(verifying ?? inc, now);
    if (verifying) {
      result.merged.push(verifying);
      this.publish(customerId, verifying, 'incident_verifying');
      this.log('[merge-poller] PR merged → verifying', {
        incident: inc.id,
        pr: pr.github_pr_number,
        sha: mergeSha.slice(0, 7),
      });
    }
  }

  /** Record the merge commit as the current deploy (SPEC §10.5 step 1). */
  private async recordMergeDeploy(
    customerId: string,
    pr: PullRequestRec,
    mergeSha: string,
    mergedAt: number,
  ): Promise<void> {
    let message = pr.title;
    let author = 'github';
    let committedAt = mergedAt;
    try {
      const { data } = await this.octokit.rest.repos.getCommit({
        owner: this.config.github.owner,
        repo: this.config.github.repo,
        ref: mergeSha,
      });
      message = data.commit.message.split('\n')[0] || message;
      author = data.author?.login ?? data.commit.author?.name ?? author;
      const dateStr = data.commit.author?.date ?? data.commit.committer?.date;
      if (dateStr) {
        const t = Date.parse(dateStr);
        if (!Number.isNaN(t)) committedAt = t;
      }
    } catch (err) {
      this.log('[merge-poller] getCommit(merge) failed; using PR metadata', err);
    }

    this.db.dao.deploys.upsert({
      customer_id: customerId,
      sha: mergeSha,
      short_sha: mergeSha.slice(0, 7),
      ref: this.config.github.defaultBranch,
      message,
      author,
      committed_at: Number.isNaN(committedAt) ? mergedAt : committedAt,
      deployed_at: mergedAt,
      is_current: true,
      source: 'merge',
      pr_id: pr.id,
    });
    this.db.dao.deploys.markCurrent(customerId, mergeSha);
  }

  /** Phase 2: evaluate one `verifying` incident against the recovery window. */
  private evaluateRecovery(
    customerId: string,
    inc: Incident,
    now: number,
    result: MergePollResult,
  ): void {
    const rollup = this.sample(customerId, inc.service, now);
    const outcome = this.verifier.evaluate(inc, now, rollup);
    if (outcome === 'pending') return;

    const pr = this.db.dao.pullRequests.getByIncident(inc.id);
    this.verifier.forget(inc.id);

    if (outcome === 'recovered') {
      const resolved = resolveIncident(this.db.dao.incidents, inc.id, now);
      if (pr) {
        void this.commentAndFinalize(pr, 'recovered', inc, rollup, now);
      }
      if (resolved) {
        result.resolved.push(resolved);
        this.publish(customerId, resolved, 'incident_resolved');
        this.log('[merge-poller] recovery verified → resolved', { incident: inc.id });
      }
    } else {
      const escalated = escalateIncident(this.db.dao.incidents, inc.id);
      if (pr) {
        void this.commentAndFinalize(pr, 'not_recovered', inc, rollup, now);
      }
      if (escalated) {
        result.escalated.push(escalated);
        this.publish(customerId, escalated, 'incident_escalated');
        this.log('[merge-poller] recovery failed → re-escalated', { incident: inc.id });
      }
    }
  }

  /** Post the recovery result comment on the PR + persist verification status. */
  private async commentAndFinalize(
    pr: PullRequestRec,
    outcome: 'recovered' | 'not_recovered',
    inc: Incident,
    rollup: Rollup,
    now: number,
  ): Promise<void> {
    const short = pr.head_sha ? pr.head_sha.slice(0, 7) : 'merge';
    const windowSec = Math.round(this.config.detection.recoveryWindowMs / 1000);
    const body =
      outcome === 'recovered'
        ? `✅ **Recovery confirmed** — error rate ${pct(rollup.error_rate)} ` +
          `(p95 ${rollup.p95_ms}ms) held below threshold after deploy \`${short}\`. ` +
          `Incident \`${inc.id}\` resolved by OnCall AI.\n\n` +
          `— Generated by OnCall AI · verified over the ${windowSec}s recovery window.`
        : `⚠️ **Recovery not confirmed** — metrics did not stabilize within ` +
          `${windowSec}s after deploy \`${short}\` (error rate ${pct(rollup.error_rate)}, ` +
          `p95 ${rollup.p95_ms}ms). Incident \`${inc.id}\` re-escalated for human review.\n\n` +
          `— Generated by OnCall AI.`;

    const verification_status = outcome;
    let commentId: number | null = null;
    try {
      const { data } = await this.octokit.rest.issues.createComment({
        owner: this.config.github.owner,
        repo: this.config.github.repo,
        issue_number: pr.github_pr_number,
        body,
      });
      commentId = data.id;
    } catch (err) {
      this.log('[merge-poller] createComment failed', err);
    }
    this.db.dao.pullRequests.update(pr.id, {
      verification_status,
      verification_comment_id: commentId,
    });
    void now; // timestamp reserved for future audit; verification time = incident.resolved_at.
  }

  private publish(customerId: string, incident: Incident, event: string): void {
    this.broker?.publish(incidentsTopic(customerId), { event, data: incident });
  }
}

/** Factory mirroring the module conventions. */
export function createMergePoller(opts: MergePollerOptions): MergePoller {
  return new MergePoller(opts);
}
