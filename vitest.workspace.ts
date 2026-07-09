import { defineWorkspace } from 'vitest/config';

// One Vitest runner across every TS package (SPEC §2). Add a project entry as
// each package gains tests; unlisted packages simply aren't collected.
export default defineWorkspace([
  {
    test: {
      name: 'shared',
      root: './packages/shared',
      environment: 'node',
      include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'sdk',
      root: './packages/sdk',
      environment: 'node',
      include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'server',
      root: './packages/server',
      environment: 'node',
      include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    },
  },
]);
