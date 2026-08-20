/**
 * QA C1 — independent contract tests for loadConfig() (SPEC §14).
 * Derived from SPEC §14 env table BEFORE reading the implementation
 * (see features/oncall-ai/qa/TEST_CASES-C1.md). Asserts that EVERY §14 var
 * is validated/defaulted with the documented value, correct type, and that
 * bad input is rejected rather than silently coerced.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('TC-25 empty env → every §14 var gets its documented default', () => {
  const c = loadConfig({});
  it('agent group defaults', () => {
    expect(c.agent.useClaudeSubscription).toBe(true);
    expect(c.agent.model).toBe('claude-sonnet-5');
    expect(c.agent.mode).toBe('auto');
    expect(c.agent.maxIterations).toBe(10);
    expect(c.agent.confidenceThreshold).toBe(0.6);
    expect(c.agent.costCapUsd).toBe(0.25);
    expect(c.agent.cacheRealPr).toBe(true);
  });
  it('github group defaults', () => {
    expect(c.github.owner).toBe('DIVIJ08070');
    expect(c.github.repo).toBe('oncall-ai-victim');
    expect(c.github.defaultBranch).toBe('main');
    expect(c.github.protectedBranches).toEqual(['main', 'master']);
  });
  it('ingest / notify defaults', () => {
    expect(c.ingest.apiKey).toBe('dev-local-ingest-key');
    expect(c.notify.slackWebhookUrl).toBeUndefined();
  });
  it('server group defaults', () => {
    expect(c.server.port).toBe(3001);
    expect(c.server.databaseUrl).toBe('./data/oncall.sqlite');
    expect(c.server.publicBaseUrl).toBe('http://localhost:3001');
    expect(c.server.dashboardUrl).toBe('http://localhost:5173');
    expect(c.server.sessionSecret).toBe('dev-secret-change-me');
    expect(c.server.devNoAuth).toBe(true);
  });
  it('detection group defaults', () => {
    expect(c.detection.intervalMs).toBe(15000);
    expect(c.detection.errorRateThreshold).toBe(0.2);
    expect(c.detection.minRequestsForDetection).toBe(5);
    expect(c.detection.latencyP95ThresholdMs).toBe(1000);
    expect(c.detection.silenceWindowMs).toBe(60000);
    expect(c.detection.recoveryWindowMs).toBe(60000);
    expect(c.detection.mergePollIntervalMs).toBe(5000);
  });
  it('victim group defaults', () => {
    expect(c.victim.port).toBe(4000);
    expect(c.victim.controlUrl).toBe('http://localhost:4000');
    expect(c.victim.ingestUrl).toBe('http://localhost:3001/api/v1/ingest');
    expect(c.victim.apiKey).toBe('dev-local-ingest-key');
  });
});

describe('TC-26 numeric vars are coerced to number type', () => {
  const c = loadConfig({});
  it('every §14 numeric var is typeof number', () => {
    for (const n of [
      c.server.port,
      c.agent.maxIterations,
      c.agent.confidenceThreshold,
      c.agent.costCapUsd,
      c.detection.intervalMs,
      c.detection.errorRateThreshold,
      c.detection.minRequestsForDetection,
      c.detection.latencyP95ThresholdMs,
      c.detection.silenceWindowMs,
      c.detection.recoveryWindowMs,
      c.detection.mergePollIntervalMs,
      c.victim.port,
    ]) {
      expect(typeof n).toBe('number');
      expect(Number.isNaN(n)).toBe(false);
    }
  });
});

describe('TC-27 boolean vars are coerced to boolean type', () => {
  const c = loadConfig({});
  it('USE_CLAUDE_SUBSCRIPTION / DEV_NO_AUTH / CACHE_REAL_PR are booleans', () => {
    expect(typeof c.agent.useClaudeSubscription).toBe('boolean');
    expect(typeof c.server.devNoAuth).toBe('boolean');
    expect(typeof c.agent.cacheRealPr).toBe('boolean');
  });
});

describe('TC-28 overrides are respected', () => {
  it('string/number/bool overrides applied with correct types', () => {
    const c = loadConfig({
      PORT: '8080',
      AGENT_MODE: 'cached',
      DEV_NO_AUTH: 'false',
      ERROR_RATE_THRESHOLD: '0.35',
      USE_CLAUDE_SUBSCRIPTION: 'no',
    });
    expect(c.server.port).toBe(8080);
    expect(typeof c.server.port).toBe('number');
    expect(c.agent.mode).toBe('cached');
    expect(c.server.devNoAuth).toBe(false);
    expect(c.detection.errorRateThreshold).toBe(0.35);
    expect(c.agent.useClaudeSubscription).toBe(false);
  });
});

describe('TC-29 GITHUB_PROTECTED_BRANCHES parsed to list', () => {
  it('default splits main,master; custom csv splits + trims', () => {
    expect(loadConfig({}).github.protectedBranches).toEqual(['main', 'master']);
    expect(
      loadConfig({ GITHUB_PROTECTED_BRANCHES: 'main, release , prod' }).github.protectedBranches,
    ).toEqual(['main', 'release', 'prod']);
  });
});

describe('TC-30/31 invalid input is rejected, not silently coerced', () => {
  it('TC-30 AGENT_MODE outside auto|live|cached throws', () => {
    expect(() => loadConfig({ AGENT_MODE: 'bogus' })).toThrow();
  });
  it('TC-31 non-numeric PORT throws (not silent NaN)', () => {
    expect(() => loadConfig({ PORT: 'notaport' })).toThrow();
  });
});

describe('TC-32 github owner/repo/default-branch defaults', () => {
  const c = loadConfig({});
  it('pinning defaults match §14', () => {
    expect(c.github.owner).toBe('DIVIJ08070');
    expect(c.github.repo).toBe('oncall-ai-victim');
    expect(c.github.defaultBranch).toBe('main');
  });
});

describe('TC-33 string defaults', () => {
  const c = loadConfig({});
  it('all documented string defaults present', () => {
    expect(c.ingest.apiKey).toBe('dev-local-ingest-key');
    expect(c.server.databaseUrl).toBe('./data/oncall.sqlite');
    expect(c.server.publicBaseUrl).toBe('http://localhost:3001');
    expect(c.server.dashboardUrl).toBe('http://localhost:5173');
    expect(c.server.sessionSecret).toBe('dev-secret-change-me');
    expect(c.agent.model).toBe('claude-sonnet-5');
    expect(c.victim.ingestUrl).toBe('http://localhost:3001/api/v1/ingest');
    expect(c.victim.controlUrl).toBe('http://localhost:4000');
  });
});

describe('TC-34 empty-by-default (secret/optional) vars stay optional', () => {
  it('unset optional vars are undefined, not a crash', () => {
    const c = loadConfig({});
    expect(c.agent.anthropicApiKey).toBeUndefined();
    expect(c.github.oauthClientId).toBeUndefined();
    expect(c.github.oauthClientSecret).toBeUndefined();
    expect(c.notify.slackWebhookUrl).toBeUndefined();
    expect(c.github.token).toBeUndefined();
  });
  it('provided optional secrets pass through', () => {
    const c = loadConfig({ GITHUB_TOKEN: 'ghp_x', SLACK_WEBHOOK_URL: 'https://hooks' });
    expect(c.github.token).toBe('ghp_x');
    expect(c.notify.slackWebhookUrl).toBe('https://hooks');
  });
});
