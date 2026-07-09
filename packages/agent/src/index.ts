/**
 * `@oncall/agent` — investigation tool layer (SPEC §9).
 *
 * C6 delivers the six read/PR tools + the `submit_findings` control tool, the
 * code-enforced SAFETY invariant (`guards.ts`: repo pinning, branch guard,
 * create-only write path, revert algorithm, FR-13 confidence gate), and the
 * bounded-output caps (`bounded.ts`). C7 adds the live investigation engine on
 * top: the Claude Agent SDK `query()` loop (`live.ts`), the in-process MCP wiring
 * (`mcp.ts`), the SDK-message → step mapper (`stream.ts`), the prompts
 * (`prompts.ts`), and the engine interface + factory (`engine.ts`) behind which
 * C8's `CachedEngine` slots in.
 */
export * from './ports.js';
export * from './guards.js';
export * from './bounded.js';
export * from './tools/index.js';
export * from './prompts.js';
export * from './mcp.js';
export * from './stream.js';
export * from './engine.js';
export * from './live.js';
export * from './cached.js';
