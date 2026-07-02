import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'planet-renderer',
    include: ['test/**/*.test.ts'],
  },
});
