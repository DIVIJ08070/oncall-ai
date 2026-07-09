import type {
  DeployRef,
  Incident,
  MetricSample,
  PullRequestRec,
} from '@oncall/shared';
import { createPinnedGitHub, type GitHubClient } from '../src/guards.js';
import type {
  ToolConfig,
  ToolContext,
  ToolCreatePrInput,
  ToolDb,
  ToolIncidentPatch,
  ToolLogQuery,
  ToolLogRow,
  ToolServiceRow,
  StepSink,
} from '../src/ports.js';

/* ── config + incident fixtures ───────────────────────────────────────────── */

export const PINNED = {
  owner: 'DIVIJ08070',
  repo: 'oncall-ai-victim',
  defaultBranch: 'main',
  protectedBranches: ['main', 'master'],
  token: 'test-token',
};

export function makeConfig(overrides: Partial<ToolConfig> = {}): ToolConfig {
  return {
    github: { ...PINNED },
    agent: { confidenceThreshold: 0.6 },
    ...overrides,
  };
}

export function makeIncident(overrides: Partial<Incident> = {}): Incident {
  const now = 1_752_000_000_000;
  return {
    id: 'inc_TEST01',
    customer_id: 'cus_TEST',
    service: 'checkout-api',
    detector: 'error_rate',
    fingerprint: 'fp-abc',
    title: 'Error-rate spike on checkout-api',
    status: 'investigating',
    severity: 'high',
    threshold_value: 0.2,
    observed_value: 0.87,
    first_error_at: now - 30_000,
    detected_at: now - 20_000,
    opened_at: now - 20_000,
    root_cause: null,
    confidence: null,
    pr_id: null,
    suspect_deploy_sha: null,
    resolved_at: null,
    postmortem: null,
    updated_at: now - 10_000,
    ...overrides,
  };
}

/* ── in-memory ToolDb ─────────────────────────────────────────────────────── */

export interface FakeDbSeed {
  logs?: ToolLogRow[];
  samples?: MetricSample[];
  deploys?: DeployRef[];
  services?: ToolServiceRow[];
}

export interface FakeDb extends ToolDb {
  /** PRs created via the write tool (assertion surface). */
  createdPrs: PullRequestRec[];
  /** Incident patches applied via the write tool (assertion surface). */
  patches: { id: string; patch: ToolIncidentPatch }[];
}

export function makeFakeDb(seed: FakeDbSeed = {}, incident?: Incident): FakeDb {
  const logs = seed.logs ?? [];
  const samples = seed.samples ?? [];
  const deploys = seed.deploys ?? [];
  const services = seed.services ?? [];
  const incidents = new Map<string, Incident>();
  if (incident) incidents.set(incident.id, { ...incident });
  const createdPrs: PullRequestRec[] = [];
  const patches: { id: string; patch: ToolIncidentPatch }[] = [];

  return {
    createdPrs,
    patches,
    dao: {
      logEvents: {
        query(q: ToolLogQuery): ToolLogRow[] {
          let rows = logs.filter((r) => {
            if (q.customer_id !== undefined && r.customer_id !== q.customer_id) return false;
            if (q.service !== undefined && r.service !== q.service) return false;
            if (q.level !== undefined && r.level !== q.level) return false;
            if (q.since !== undefined && r.timestamp < q.since) return false;
            if (q.until !== undefined && r.timestamp > q.until) return false;
            if (q.before !== undefined && r.timestamp >= q.before) return false;
            return true;
          });
          rows = rows.sort((a, b) => b.timestamp - a.timestamp);
          const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
          return rows.slice(0, limit);
        },
      },
      metricSamples: {
        latestForService(customerId, service) {
          const s = samples
            .filter((m) => m.customer_id === customerId && m.service === service)
            .sort((a, b) => b.bucket_ts - a.bucket_ts);
          return s[0] ?? null;
        },
        seriesForService(customerId, service, sinceTs, limit = 240) {
          const s = samples
            .filter(
              (m) =>
                m.customer_id === customerId &&
                m.service === service &&
                m.bucket_ts >= sinceTs,
            )
            .sort((a, b) => a.bucket_ts - b.bucket_ts);
          return s.slice(-Math.min(Math.max(limit, 1), 240));
        },
      },
      deploys: {
        getBySha(customerId, sha) {
          return deploys.find((d) => d.customer_id === customerId && d.sha === sha) ?? null;
        },
        getCurrent(customerId) {
          return (
            deploys.find((d) => d.customer_id === customerId && d.is_current) ?? null
          );
        },
        listRecent(customerId, limit = 20) {
          return deploys
            .filter((d) => d.customer_id === customerId)
            .sort((a, b) => b.committed_at - a.committed_at)
            .slice(0, limit);
        },
      },
      incidents: {
        update(id, patch) {
          patches.push({ id, patch });
          const cur = incidents.get(id);
          if (!cur) return null;
          const next = { ...cur, ...patch, updated_at: Date.now() } as Incident;
          incidents.set(id, next);
          return next;
        },
      },
      pullRequests: {
        create(input: ToolCreatePrInput): PullRequestRec {
          const row: PullRequestRec = {
            id: `pr_${createdPrs.length + 1}`,
            incident_id: input.incident_id,
            customer_id: input.customer_id,
            github_pr_number: input.github_pr_number,
            github_pr_id: input.github_pr_id,
            branch: input.branch,
            base_branch: input.base_branch,
            title: input.title,
            url: input.url,
            kind: input.kind,
            state: 'open',
            diagnostic_report: input.diagnostic_report,
            head_sha: input.head_sha,
            created_at: Date.now(),
            merged_at: null,
            verification_status: 'pending',
            verification_comment_id: null,
          };
          createdPrs.push(row);
          return row;
        },
      },
      services: {
        getByName(_customerId, name) {
          return services.find((s) => s.name === name) ?? null;
        },
      },
    },
  };
}

/* ── recording fake GitHub client (satisfies the narrow GitHubClient) ─────── */

export interface RecordedCall {
  ep: string;
  owner?: string;
  repo?: string;
  params: Record<string, unknown>;
}

export interface FakeGitHubSeed {
  /** ref name (e.g. `heads/main`) → sha. */
  refs?: Record<string, string>;
  /** commit ref/sha → detail. */
  commits?: Record<
    string,
    {
      treeSha?: string;
      parents?: string[];
      files?: {
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
      }[];
      message?: string;
      author?: string;
      date?: string;
    }
  >;
  /** `${ref}:${path}` → utf8 content served by getContent. */
  contents?: Record<string, string>;
  /** listCommits result. */
  commitList?: {
    sha: string;
    message: string;
    author?: string;
    date?: string;
  }[];
  /** compareCommitsWithBasehead result files, keyed `base...head`. */
  compares?: Record<
    string,
    {
      baseSha?: string;
      files?: {
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
      }[];
    }
  >;
  prNumber?: number;
  prId?: number;
}

export interface FakeGitHub {
  client: GitHubClient;
  calls: RecordedCall[];
}

export function makeFakeGitHub(seed: FakeGitHubSeed = {}): FakeGitHub {
  const calls: RecordedCall[] = [];
  let blobN = 0;
  let treeN = 0;
  let commitN = 0;
  const refs: Record<string, string> = { 'heads/main': 'baseSha0', ...seed.refs };

  const rec = (ep: string, p: { owner?: string; repo?: string; [k: string]: unknown }) =>
    calls.push({ ep, owner: p.owner, repo: p.repo, params: p });

  const client: GitHubClient = {
    rest: {
      repos: {
        async listCommits(p) {
          rec('repos.listCommits', p);
          const list = seed.commitList ?? [];
          return {
            data: list.map((c) => ({
              sha: c.sha,
              commit: {
                message: c.message,
                author: { name: c.author ?? 'seed', date: c.date ?? '2026-07-09T00:00:00Z' },
              },
              author: { login: c.author ?? 'seed' },
            })),
          };
        },
        async getCommit(p) {
          rec('repos.getCommit', p);
          const c = seed.commits?.[p.ref];
          if (!c) throw notFound(`commit ${p.ref}`);
          return {
            data: {
              sha: p.ref,
              commit: {
                message: c.message ?? 'seed commit',
                author: { name: c.author ?? 'seed', date: c.date ?? '2026-07-09T00:00:00Z' },
                tree: { sha: c.treeSha ?? `tree-of-${p.ref}` },
              },
              author: { login: c.author ?? 'seed' },
              parents: (c.parents ?? []).map((sha) => ({ sha })),
              files: c.files,
              stats: c.files
                ? {
                    additions: c.files.reduce((n, f) => n + f.additions, 0),
                    deletions: c.files.reduce((n, f) => n + f.deletions, 0),
                  }
                : undefined,
            },
          };
        },
        async compareCommitsWithBasehead(p) {
          rec('repos.compareCommitsWithBasehead', p);
          const cmp = seed.compares?.[p.basehead];
          if (!cmp) throw notFound(`compare ${p.basehead}`);
          return {
            data: {
              base_commit: { sha: cmp.baseSha ?? p.basehead.split('...')[0] },
              files: cmp.files,
            },
          };
        },
        async getContent(p) {
          rec('repos.getContent', p);
          const key = `${p.ref}:${p.path}`;
          const content = seed.contents?.[key];
          if (content === undefined) throw notFound(`content ${key}`);
          return {
            data: {
              type: 'file',
              path: p.path,
              content: Buffer.from(content, 'utf8').toString('base64'),
              encoding: 'base64',
              sha: `blobsha-${key}`,
            },
          };
        },
      },
      git: {
        async getRef(p) {
          rec('git.getRef', p);
          const sha = refs[p.ref.replace(/^refs\//, '')];
          if (!sha) throw notFound(`ref ${p.ref}`);
          return { data: { object: { sha } } };
        },
        async createBlob(p) {
          rec('git.createBlob', p);
          return { data: { sha: `blob-${++blobN}` } };
        },
        async createTree(p) {
          rec('git.createTree', p);
          return { data: { sha: `tree-${++treeN}` } };
        },
        async createCommit(p) {
          rec('git.createCommit', p);
          return { data: { sha: `commit-${++commitN}` } };
        },
        async createRef(p) {
          rec('git.createRef', p);
          refs[p.ref.replace(/^refs\//, '')] = p.sha;
          return { data: { ref: p.ref, object: { sha: p.sha } } };
        },
      },
      pulls: {
        async create(p) {
          rec('pulls.create', p);
          return {
            data: {
              number: seed.prNumber ?? 42,
              id: seed.prId ?? 9001,
              html_url: `https://github.com/${p.owner}/${p.repo}/pull/${seed.prNumber ?? 42}`,
              head: { sha: refs[`heads/${p.head}`] ?? `commit-${commitN}` },
            },
          };
        },
      },
    },
  };

  return { client, calls };
}

function notFound(what: string): Error {
  const e = new Error(`Not Found: ${what}`) as Error & { status: number };
  e.status = 404;
  return e;
}

/* ── ToolContext assembly ─────────────────────────────────────────────────── */

export interface RecordingSink extends StepSink {
  prCreatedCalls: { number: number; url: string; kind: string }[];
  conclusionCalls: { root_cause: string; confidence: number; decision: string }[];
}

export function makeRecordingSink(): RecordingSink {
  const prCreatedCalls: RecordingSink['prCreatedCalls'] = [];
  const conclusionCalls: RecordingSink['conclusionCalls'] = [];
  return {
    prCreatedCalls,
    conclusionCalls,
    prCreated: (d) => void prCreatedCalls.push(d),
    conclusion: (d) => void conclusionCalls.push(d),
  };
}

export interface TestCtx {
  ctx: ToolContext;
  db: FakeDb;
  github: FakeGitHub;
  sink: RecordingSink;
}

export function makeCtx(opts: {
  db?: FakeDb;
  githubSeed?: FakeGitHubSeed;
  config?: ToolConfig;
  incident?: Incident;
} = {}): TestCtx {
  const incident = opts.incident ?? makeIncident();
  const db = opts.db ?? makeFakeDb({}, incident);
  const github = makeFakeGitHub(opts.githubSeed);
  const config = opts.config ?? makeConfig();
  const sink = makeRecordingSink();
  const octokit = createPinnedGitHub(github.client, config.github);
  const ctx: ToolContext = {
    db,
    octokit,
    config,
    customer: { id: incident.customer_id },
    incident,
    sink,
  };
  return { ctx, db, github, sink };
}
