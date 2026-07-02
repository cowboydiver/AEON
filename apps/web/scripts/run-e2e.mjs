#!/usr/bin/env node
/**
 * Runs Playwright with an X display guaranteed to exist.
 *
 * WebGPU canvas presentation is broken in headless Chromium on SwiftShader
 * (the GPU device is lost on the first getCurrentTexture render), so the e2e
 * suite runs a headed browser. On displayless Linux (CI, containers) we wrap
 * it in xvfb-run; anywhere with a real display it runs directly.
 */
import { spawnSync } from 'node:child_process';

const args = ['playwright', 'test', ...process.argv.slice(2)];

const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY;
const hasXvfb = needsXvfb && spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).error === undefined;

if (needsXvfb && !hasXvfb) {
  console.error('run-e2e: no $DISPLAY and xvfb-run not found — install xvfb or run with a display.');
  process.exit(1);
}

const command = hasXvfb ? 'xvfb-run' : 'pnpm';
const commandArgs = hasXvfb ? ['-a', 'pnpm', 'exec', ...args] : ['exec', ...args];
const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
process.exit(result.status ?? 1);
