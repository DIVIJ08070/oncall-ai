/**
 * Per-endpoint performance analysis — the "click an API row for its analysis"
 * feature of Project Health. Fetches the handler's real source file from
 * GitHub, asks the AI (Claude-first, Gemini fallback — reusing the health
 * report engine) to assess it for DB/performance problems, and returns
 * concrete findings (missing index, N+1, no pagination…) + suggestions.
 */

import { z } from 'zod';
import type { Config } from '../../config.js';
import { CodeReviewError } from '../code-review/types.js';
import { generateHealthText, parseModelJson } from './report.js';

const GITHUB_URL_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

export interface EndpointAnalysis {
  method: string;
  path: string;
  file: string;
  summary: string;
  findings: Array<{
    severity: 'high' | 'medium' | 'low';
    title: string;
    detail: string;
  }>;
  suggestions: string[];
  engine: 'claude' | 'gemini';
}

const AiSchema = z.object({
  summary: z.string().default(''),
  findings: z
    .array(
      z.object({
        severity: z.enum(['high', 'medium', 'low']).catch('medium'),
        title: z.string(),
        detail: z.string().default(''),
      }),
    )
    .default([]),
  suggestions: z.array(z.string()).default([]),
});

/** Fetch a file's text from a public GitHub repo (default branch via HEAD). */
async function fetchFile(
  owner: string,
  repo: string,
  file: string,
): Promise<string | null> {
  const clean = file.replace(/^\/+/, '');
  for (const ref of ['HEAD', 'main', 'master']) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${clean}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) return await res.text();
    } catch {
      // try the next ref
    }
  }
  return null;
}

const SYSTEM_HINT =
  'You are a senior backend performance reviewer. Analyse ONE HTTP endpoint ' +
  'handler for DATABASE and runtime performance problems: missing indexes on ' +
  'filtered/ordered/joined columns, N+1 query patterns, unbounded/missing ' +
  'pagination, SELECT * over wide tables, missing caching, heavy work in the ' +
  'request path. Be specific to the code shown; do not invent problems that ' +
  "aren't visible. Reply with ONLY a JSON object.";

export async function analyzeEndpoint(
  config: Config,
  input: { repoUrl: string; method: string; path: string; file: string },
): Promise<EndpointAnalysis> {
  const m = GITHUB_URL_RE.exec(input.repoUrl);
  if (!m) {
    throw new CodeReviewError(400, 'validation_error', 'Invalid GitHub repo URL');
  }
  const [, owner, repo] = m;
  const source = await fetchFile(owner, repo, input.file);

  const codeBlock = source
    ? source.slice(0, 12_000)
    : '(source file could not be fetched — assess from the method + path only)';

  const prompt = [
    SYSTEM_HINT,
    '',
    `Endpoint: ${input.method.toUpperCase()} ${input.path}`,
    `File: ${input.file}`,
    '',
    'Source:',
    '```',
    codeBlock,
    '```',
    '',
    'Return STRICT JSON exactly:',
    '{ "summary": "one line on this endpoint\'s performance health",',
    '  "findings": [ { "severity": "high|medium|low", "title": "...", "detail": "..." } ],',
    '  "suggestions": [ "concrete fix", ... ] }',
    'If the handler looks fine, return an empty findings array and say so in the summary.',
  ].join('\n');

  const { text, engine } = await generateHealthText(config, prompt);
  const parsed = AiSchema.safeParse(parseModelJson(text));
  if (!parsed.success) {
    throw new CodeReviewError(
      502,
      'upstream_error',
      'The AI returned an unparseable analysis — try again in a moment.',
    );
  }
  return {
    method: input.method.toUpperCase(),
    path: input.path,
    file: input.file,
    summary: parsed.data.summary,
    findings: parsed.data.findings,
    suggestions: parsed.data.suggestions,
    engine,
  };
}
