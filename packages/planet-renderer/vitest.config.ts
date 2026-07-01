import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'planet-renderer',
    include: ['test/**/*.test.ts'],
    // No tests until Milestone 4 adds geometry tests.
    passWithNoTests: true,
  },
});
