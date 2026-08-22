import { describe, expect, it } from 'vitest';
import { calculateEndpointScore } from '../performance-score.js';
import { computeRiskScore, predictBreach, type Point } from '../trend-prediction.js';

describe('calculateEndpointScore', () => {
  // SPEC test 1: badly degraded endpoint.
  it('scores a slow, error-prone endpoint as CRITICAL', () => {
    const s = calculateEndpointScore(1200, 150, 0.05, 0.02);
    expect(s.overall_score).toBeLessThan(50);
    expect(s.grade).toBe('CRITICAL');
    expect(s.latency_score).toBeLessThan(20);
  });

  // SPEC test 2: healthy endpoint.
  it('scores a fast, clean endpoint as EXCELLENT', () => {
    const s = calculateEndpointScore(140, 150, 0.001, 0);
    expect(s.overall_score).toBeGreaterThanOrEqual(90);
    expect(s.grade).toBe('EXCELLENT');
  });

  // FIXED SPEC BUG: throughput sub-score must react to traffic instability.
  it('penalises throughput when rps deviates from baseline', () => {
    const stable = calculateEndpointScore(140, 150, 0.001, 0, {
      rps: 100,
      baselineRps: 100,
    });
    const spiking = calculateEndpointScore(140, 150, 0.001, 0, {
      rps: 300,
      baselineRps: 100,
    });

    expect(stable.throughput_score).toBe(10);
    expect(spiking.throughput_score).toBeLessThan(stable.throughput_score);
    expect(spiking.overall_score).toBeLessThan(stable.overall_score);
  });

  it('leaves throughput at full weight when no rps baseline is supplied', () => {
    const s = calculateEndpointScore(140, 150, 0.001, 0);
    expect(s.throughput_score).toBe(10);
  });
});

describe('predictBreach', () => {
  const rising: Point[] = [
    { t: 0, value: 100 },
    { t: 1, value: 120 },
    { t: 2, value: 140 },
    { t: 3, value: 160 },
  ];

  // Rule 6: already over threshold.
  it('reports BREACHED immediately when currentValue >= threshold', () => {
    const p = predictBreach(rising, 150, 100, 180);
    expect(p.status).toBe('BREACHED');
    expect(p.probability).toBeCloseTo(0.99, 5);
    expect(p.minutesToBreach).toBe(0);
    expect(p.riskScore).toBe(100);
  });

  // Rule 7: epsilon-guarded denominator — baseline == threshold must not NaN.
  it('does not produce NaN when baseline equals threshold', () => {
    const p = predictBreach(rising, 100, 100, 90);
    expect(Number.isNaN(p.probability)).toBe(false);
    expect(Number.isFinite(p.probability)).toBe(true);
    expect(Number.isFinite(p.riskScore)).toBe(true);
    expect(p.minutesToBreach === null || Number.isFinite(p.minutesToBreach)).toBe(true);
  });

  // Rule 9: cold-start — fewer than MIN_CONSECUTIVE_WINDOWS points.
  it('returns NORMAL under 3 points (cold start)', () => {
    const p = predictBreach(
      [
        { t: 0, value: 100 },
        { t: 1, value: 110 },
      ],
      300,
      100,
      110,
    );
    expect(p.status).toBe('NORMAL');
    expect(p.minutesToBreach).toBeNull();
  });

  // A genuinely rising series must project a finite minutes-to-breach.
  it('predicts a finite minutesToBreach for a rising series', () => {
    const p = predictBreach(rising, 300, 100, 160, { windowMinutes: 5 });
    expect(p.minutesToBreach).not.toBeNull();
    expect(Number.isFinite(p.minutesToBreach as number)).toBe(true);
    expect(p.minutesToBreach as number).toBeGreaterThan(0);
    expect(p.status).not.toBe('NORMAL');
    expect(p.status).not.toBe('BREACHED');
  });

  it('holds at NORMAL for a flat series well below threshold', () => {
    const flat: Point[] = [
      { t: 0, value: 100 },
      { t: 1, value: 100 },
      { t: 2, value: 100 },
      { t: 3, value: 100 },
    ];
    const p = predictBreach(flat, 300, 100, 100);
    expect(p.minutesToBreach).toBeNull();
    expect(p.status).toBe('NORMAL');
  });
});

describe('computeRiskScore', () => {
  it('pins risk at 100 when the prediction is BREACHED', () => {
    const score = calculateEndpointScore(1200, 150, 0.05, 0.02);
    const prediction = predictBreach([], 150, 100, 200);
    expect(computeRiskScore(score, prediction)).toBe(100);
  });

  it('blends performance deficit and prediction probability (0-100)', () => {
    const score = calculateEndpointScore(140, 150, 0.001, 0);
    const prediction = predictBreach(
      [
        { t: 0, value: 100 },
        { t: 1, value: 100 },
        { t: 2, value: 100 },
      ],
      300,
      100,
      100,
    );
    const risk = computeRiskScore(score, prediction);
    expect(risk).toBeGreaterThanOrEqual(0);
    expect(risk).toBeLessThanOrEqual(100);
  });
});
