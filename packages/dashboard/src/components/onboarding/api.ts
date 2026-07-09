import type {
  ReposResponse,
  RepoSelectRequest,
  RepoSelectResponse,
  IntegrationSnippetResponse,
} from '@oncall/shared';
import { apiFetch, apiUrl } from '../../api/client';

/**
 * Onboarding-scoped API calls (SPEC §7.5/§7.6, FR-15/FR-02). Kept in the
 * onboarding folder (owned by C14) rather than the shared `src/api/index.ts` so
 * C13/C14/C15 extend the frontend↔API layer in parallel with zero shared-file
 * collisions. All calls resolve DTOs from `@oncall/shared` and reuse the base
 * `apiFetch` (credentialed, SPEC §7 error shape). `getServices`/`getAuthMe` still
 * come from the shared client (imported read-only) — no duplication there.
 */

/** `GET /api/v1/repos` (SPEC §7.5) — repos the caller's token can open PRs against. */
export function getRepos(signal?: AbortSignal): Promise<ReposResponse> {
  return apiFetch<ReposResponse>('/repos', { signal });
}

/** `POST /api/v1/repos/select` (SPEC §7.5) — bind the customer repo; `422` on missing perms. */
export function selectRepo(
  body: RepoSelectRequest,
  signal?: AbortSignal,
): Promise<RepoSelectResponse> {
  return apiFetch<RepoSelectResponse>('/repos/select', {
    method: 'POST',
    body,
    signal,
  });
}

/** `GET /api/v1/integration-snippet` (SPEC §7.6) — ingest URL/key + SDK & tailer snippets. */
export function getIntegrationSnippet(
  signal?: AbortSignal,
): Promise<IntegrationSnippetResponse> {
  return apiFetch<IntegrationSnippetResponse>('/integration-snippet', { signal });
}

/**
 * Absolute URL for the GitHub OAuth login redirect (SPEC §7.5). Returns `302` to
 * GitHub when creds are configured, `503 upstream_error` while
 * `GITHUB_OAUTH_CLIENT_ID/SECRET` are empty — the sign-in step probes it and shows
 * the "sign-in unavailable" affordance on 503 (MAPPING creds row / DEV_NO_AUTH).
 */
export function githubLoginUrl(): string {
  return apiUrl('/auth/github/login');
}
