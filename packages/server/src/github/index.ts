import { Octokit } from '@octokit/rest';
import type { Config } from '../config.js';
import type { MergePollerOctokit } from './merge-poller.js';

/**
 * GitHub integration module (SPEC §7.5, §10.5, §11): OAuth gateway, session
 * helpers, repo onboarding, and the merge poller + recovery verifier.
 */
export * from './gateway.js';
export * from './session.js';
export * from './merge-poller.js';

/**
 * Platform Octokit (the pinned `GITHUB_TOKEN` PAT) for the merge poller. The real
 * `@octokit/rest` client is a superset of the narrow `MergePollerOctokit` surface
 * (which deliberately omits `pulls.merge`), so we cast at this one boundary — the
 * poller code can never name a merge/force verb.
 */
export function createPlatformOctokit(config: Config): MergePollerOctokit {
  return new Octokit({ auth: config.github.token }) as unknown as MergePollerOctokit;
}
