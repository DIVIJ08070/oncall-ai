import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig (SPEC §14)', () => {
  it('applies documented defaults from an empty environment', () => {
    const c = loadConfig({});
    expect(c.server.port).toBe(3001);
    expect(c.server.databaseUrl).toBe('./data/oncall.sqlite');
    expect(c.server.devNoAuth).toBe(true);
    expect(c.agent.model).toBe('claude-sonnet-5');
    expect(c.agent.mode).toBe('auto');
    expect(c.agent.maxIterations).toBe(10);
    expect(c.agent.confidenceThreshold).toBe(0.6);
    expect(c.agent.costCapUsd).toBe(0.25);
    expect(c.agent.useClaudeSubscription).toBe(true);
    expect(c.github.owner).toBe('DIVIJ08070');
    expect(c.github.repo).toBe('oncall-ai-victim');
    expect(c.github.defaultBranch).toBe('main');
    expect(c.github.protectedBranches).toEqual(['main', 'master']);
    expect(c.ingest.apiKey).toBe('dev-local-ingest-key');
    expect(c.detection.intervalMs).toBe(15000);
    expect(c.detection.errorRateThreshold).toBe(0.2);
    expect(c.detection.minRequestsForDetection).toBe(5);
    expect(c.detection.latencyP95ThresholdMs).toBe(1000);
    expect(c.victim.port).toBe(4000);
  });

  it('coerces numbers and booleans from strings', () => {
    const c = loadConfig({
      PORT: '8080',
      DEV_NO_AUTH: 'false',
      USE_CLAUDE_SUBSCRIPTION: '0',
      ERROR_RATE_THRESHOLD: '0.35',
      AGENT_MAX_ITERATIONS: '4',
    });
    expect(c.server.port).toBe(8080);
    expect(c.server.devNoAuth).toBe(false);
    expect(c.agent.useClaudeSubscription).toBe(false);
    expect(c.detection.errorRateThreshold).toBe(0.35);
    expect(c.agent.maxIterations).toBe(4);
  });

  it('treats blank strings as unset (default wins)', () => {
    const c = loadConfig({ PORT: '', AGENT_MODEL: '', GITHUB_TOKEN: '' });
    expect(c.server.port).toBe(3001);
    expect(c.agent.model).toBe('claude-sonnet-5');
    expect(c.github.token).toBeUndefined();
  });

  it('keeps optional secrets undefined when absent', () => {
    const c = loadConfig({});
    expect(c.github.token).toBeUndefined();
    expect(c.agent.anthropicApiKey).toBeUndefined();
    expect(c.notify.slackWebhookUrl).toBeUndefined();
    expect(c.github.oauthClientId).toBeUndefined();
  });

  it('parses the protected-branch denylist into a trimmed list', () => {
    const c = loadConfig({ GITHUB_PROTECTED_BRANCHES: 'main, master , release' });
    expect(c.github.protectedBranches).toEqual(['main', 'master', 'release']);
  });

  it('rejects an invalid AGENT_MODE', () => {
    expect(() => loadConfig({ AGENT_MODE: 'turbo' })).toThrow(/environment/i);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/environment/i);
  });
});
