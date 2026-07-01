import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'tmp/**',
      'apps/web/e2e/artifacts/**',
      'apps/web/test-results/**',
      'apps/web/playwright-report/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    // Determinism guard: the simulation kernel must never read wall-clock time
    // or ambient randomness. All randomness flows through rng.ts / hash.ts.
    // (Non-deterministic key-order iteration is enforced by review, not lint.)
    files: ['packages/sim-kernel/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Banned in sim-kernel: use the seeded PRNG in rng.ts.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Banned in sim-kernel: wall-clock time breaks determinism.',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'Banned in sim-kernel: wall-clock time breaks determinism.',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'performance',
          message: 'Banned in sim-kernel: wall-clock time breaks determinism.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Banned in sim-kernel: wall-clock time breaks determinism.',
        },
      ],
    },
  },
);
