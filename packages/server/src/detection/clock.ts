/**
 * Injectable clock (SPEC §10.1). The detection loop reads "now" only through a
 * `Clock` so tests can advance time deterministically — no wall-clock `sleep`.
 * Production uses `systemClock`; tests use `ManualClock`.
 */
export interface Clock {
  now(): number;
}

/** Real wall-clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
};

/** Test/inject clock whose time only moves when you tell it to. */
export class ManualClock implements Clock {
  constructor(private t = 0) {}

  now(): number {
    return this.t;
  }

  /** Set absolute time (ms). */
  set(t: number): number {
    this.t = t;
    return this.t;
  }

  /** Advance by `ms` and return the new time. */
  advance(ms: number): number {
    this.t += ms;
    return this.t;
  }
}
