import { Octokit } from '@octokit/rest';
import type { Config } from '../config.js';

/**
 * GitHub gateway (SPEC §7.5, FR-15). The external-IO seam for the OAuth flow and
 * repo onboarding: the token exchange, the authenticated-user lookup, and repo
 * listing / permission checks all go through this interface so routes stay pure
 * and tests inject a fake (`inject()` needs no network).
 *
 * The default implementation uses native `fetch` for the OAuth token exchange
 * and Octokit (user token) for repo reads — no secret ever reaches the agent or
 * the client (NFR-02).
 */

/** GitHub user profile fields we persist (SPEC §8 `users`). */
export interface GithubUserProfile {
  id: number;
  login: string;
  avatar_url: string | null;
}

/** Repo metadata used by repo listing + the select permission gate (SPEC §7.5). */
export interface GithubRepoInfo {
  owner: string;
  repo: string;
  default_branch: string;
  private: boolean;
  /** `push:true` ⇒ Contents+PRs writable (the §7.5 422 gate). */
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  };
}

export interface GithubGateway {
  /** Whether OAuth is configured (client id+secret present). */
  readonly oauthConfigured: boolean;
  /** Build the GitHub authorize URL for the login redirect (SPEC §7.5). */
  authorizeUrl(state: string): string;
  /** Exchange an OAuth `code` for a user access token (SPEC §7.5 callback). */
  exchangeCode(code: string): Promise<{ accessToken: string }>;
  /** The authenticated GitHub user for a token. */
  getUser(token: string): Promise<GithubUserProfile>;
  /** Repos the token can access (onboarding repo picker). */
  listRepos(token: string): Promise<GithubRepoInfo[]>;
  /** One repo's metadata + permissions (repo-select gate). */
  getRepo(token: string, owner: string, repo: string): Promise<GithubRepoInfo>;
}

/** OAuth scopes required for sign-in + repo authorization (SPEC §7.5). */
export const OAUTH_SCOPES = 'repo read:user';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** The OAuth callback URL derived from `PUBLIC_BASE_URL` (SPEC §14). */
export function callbackUrl(config: Config): string {
  return `${config.server.publicBaseUrl.replace(/\/+$/, '')}/api/v1/auth/github/callback`;
}

function splitFullName(fullName: string): { owner: string; repo: string } {
  const slash = fullName.indexOf('/');
  if (slash === -1) return { owner: '', repo: fullName };
  return { owner: fullName.slice(0, slash), repo: fullName.slice(slash + 1) };
}

/** Construct the production gateway (fetch OAuth + Octokit reads). */
export function createGithubGateway(config: Config): GithubGateway {
  const clientId = config.github.oauthClientId;
  const clientSecret = config.github.oauthClientSecret;

  return {
    oauthConfigured: Boolean(clientId && clientSecret),

    authorizeUrl(state: string): string {
      const params = new URLSearchParams({
        client_id: clientId ?? '',
        redirect_uri: callbackUrl(config),
        scope: OAUTH_SCOPES,
        state,
        allow_signup: 'false',
      });
      return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
    },

    async exchangeCode(code: string): Promise<{ accessToken: string }> {
      const res = await fetch(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: callbackUrl(config),
        }),
      });
      if (!res.ok) {
        throw new Error(`GitHub token exchange failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };
      if (!data.access_token) {
        throw new Error(
          `GitHub token exchange returned no access_token${
            data.error ? `: ${data.error_description ?? data.error}` : ''
          }`,
        );
      }
      return { accessToken: data.access_token };
    },

    async getUser(token: string): Promise<GithubUserProfile> {
      const octokit = new Octokit({ auth: token });
      const { data } = await octokit.rest.users.getAuthenticated();
      return { id: data.id, login: data.login, avatar_url: data.avatar_url ?? null };
    },

    async listRepos(token: string): Promise<GithubRepoInfo[]> {
      const octokit = new Octokit({ auth: token });
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        per_page: 100,
        sort: 'updated',
        affiliation: 'owner,collaborator,organization_member',
      });
      return data.map((r) => {
        const { owner, repo } = splitFullName(r.full_name);
        return {
          owner: owner || r.owner?.login || '',
          repo: repo || r.name,
          default_branch: r.default_branch ?? 'main',
          private: Boolean(r.private),
          permissions: r.permissions,
        };
      });
    },

    async getRepo(token: string, owner: string, repo: string): Promise<GithubRepoInfo> {
      const octokit = new Octokit({ auth: token });
      const { data } = await octokit.rest.repos.get({ owner, repo });
      return {
        owner: data.owner?.login ?? owner,
        repo: data.name,
        default_branch: data.default_branch ?? 'main',
        private: Boolean(data.private),
        permissions: data.permissions,
      };
    },
  };
}

/** True when the repo grants write (Contents + PRs) — the §7.5 select gate. */
export function repoIsWritable(info: GithubRepoInfo): boolean {
  const p = info.permissions;
  return Boolean(p?.push || p?.admin || p?.maintain);
}
