import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Fixture proving the sim-kernel determinism lint override actually fires.
// Code is linted virtually at a path inside sim-kernel/src so the scoped
// flat-config override applies; the same code at a sim-cli path must pass.

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const kernelPath = 'packages/sim-kernel/src/__lint-fixture__.ts';
const outsidePath = 'packages/sim-cli/src/__lint-fixture__.ts';

const BANNED_FIXTURES = [
  'export const a = Math.random();',
  'export const b = Date.now();',
  'export const c = performance.now();',
];

describe('sim-kernel determinism lint rules', () => {
  it('rejects Math.random, Date.now and performance.now inside sim-kernel/src', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    for (const code of BANNED_FIXTURES) {
      const [result] = await eslint.lintText(code, { filePath: kernelPath });
      expect(result, code).toBeDefined();
      expect(result!.errorCount, `expected lint error for: ${code}`).toBeGreaterThan(0);
      expect(
        result!.messages.some((m) => m.ruleId?.startsWith('no-restricted')),
        `expected a no-restricted-* violation for: ${code}`,
      ).toBe(true);
    }
  });

  it('allows the same code outside sim-kernel', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    for (const code of BANNED_FIXTURES) {
      const [result] = await eslint.lintText(code, { filePath: outsidePath });
      expect(result, code).toBeDefined();
      const restricted = result!.messages.filter((m) => m.ruleId?.startsWith('no-restricted'));
      expect(restricted, `unexpected determinism violation outside kernel: ${code}`).toHaveLength(0);
    }
  });
});
