import { defineConfig, configDefaults } from 'vitest/config';

// Minimal vitest config for Stryker mutation runs: the node unit-test
// project only — no browser matrix, no integration (needs a live mint),
// no coverage/junit reporters (pure overhead when running thousands of
// mutant test passes).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: [
      'test/{auth,integration}.test.ts',
      'test/**.browser.test.ts',
      'test/consumer/**/*.test.ts',
      ...configDefaults.exclude,
    ],
  },
});
