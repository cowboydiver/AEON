import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'sim-kernel',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
