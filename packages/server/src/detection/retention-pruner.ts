import type { Config } from '../config.js';
import type { OncallDb } from '../db/index.js';
import { type Clock, systemClock } from './clock.js';
import type { DetectionLogger } from './seams.js';

/**
 * Raw-sample retention pruner (AI Incident PREVENTION Phase 1).
 *
 * `api_request_samples` is a high-write, short-lived table: the ingest writer
 * appends one row per observed request, and the performance ticker only ever
 * aggregates the trailing `PERF_WINDOW_SEC`. Left unbounded it would grow
 * without limit, so every `PRUNE_INTERVAL_SEC` this loop deletes rows older than
 * `RAW_RETENTION_HOURS` in bounded batches (Postgres chunked delete), keeping
 * the table small without ever locking it for long.
 *
 * Guards mirror the performance ticker: an `isPruning` single-flight mutex so
 * prune cycles never overlap, and time read only through an injected `Clock`.
 */

export interface RetentionPrunerOptions {
  db: OncallDb;
  config: Config;
  clock?: Clock;
  logger?: DetectionLogger;
}

/** Rows deleted per chunked `DELETE` (bounds each statement's lock/duration). */
export const PRUNE_BATCH_SIZE = 500;

export class RetentionPruner {
  private readonly db: OncallDb;
  private readonly config: Config;
  private readonly clock: Clock;
  private readonly log: DetectionLogger;

  private timer?: ReturnType<typeof setInterval>;
  private isPruning = false; // single-flight mutex

  constructor(opts: RetentionPrunerOptions) {
    this.db = opts.db;
    this.config = opts.config;
    this.clock = opts.clock ?? systemClock;
    this.log = opts.logger ?? (() => {});
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Start the `PRUNE_INTERVAL_SEC` retention loop. Idempotent; no-op when the
   * performance subsystem is disabled (nothing populates the raw table then).
   */
  start(): void {
    if (!this.config.performance.enabled) {
      this.log('[retention] pruner disabled (PERF_ENABLED=false)');
      return;
    }
    if (this.timer) return;
    const intervalMs = this.config.performance.pruneIntervalSec * 1000;
    this.timer = setInterval(() => {
      if (this.isPruning) return; // never overlap prune cycles
      this.isPruning = true;
      void this.prune()
        .catch((err: unknown) => this.log('[retention] prune error', err))
        .finally(() => {
          this.isPruning = false;
        });
    }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log('[retention] pruner started', {
      retentionHours: this.config.performance.rawRetentionHours,
      intervalSec: this.config.performance.pruneIntervalSec,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.log('[retention] pruner stopped');
    }
  }

  /** Delete every `api_request_samples` row older than the retention horizon. */
  async prune(): Promise<number> {
    const cutoff =
      this.clock.now() -
      this.config.performance.rawRetentionHours * 60 * 60 * 1000;
    const deleted = await this.db.dao.apiRequestSamples.pruneOlderThanInBatches(
      cutoff,
      PRUNE_BATCH_SIZE,
    );
    if (deleted > 0) {
      this.log('[retention] pruned raw samples', { deleted, cutoff });
    }
    return deleted;
  }
}

/** Factory mirroring the detection-engine / performance-ticker convention. */
export function createRetentionPruner(
  opts: RetentionPrunerOptions,
): RetentionPruner {
  return new RetentionPruner(opts);
}
