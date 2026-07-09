/**
 * `@oncall/agent` — investigation tool layer (SPEC §9).
 *
 * C6 delivers the six read/PR tools + the `submit_findings` control tool, the
 * code-enforced SAFETY invariant (`guards.ts`: repo pinning, branch guard,
 * create-only write path, revert algorithm, FR-13 confidence gate), and the
 * bounded-output caps (`bounded.ts`). The engine/loop (`live.ts`, `cached.ts`,
 * `mcp.ts`, `stream.ts`) land in C7/C8 and consume this layer through the
 * `ToolContext` port.
 */
export * from './ports.js';
export * from './guards.js';
export * from './bounded.js';
export * from './tools/index.js';
