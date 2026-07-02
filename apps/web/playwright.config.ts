import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:5173',
    // WebGPU in this Chromium only presents to a canvas via the headed
    // compositor path with Vulkan-on-SwiftShader; plain headless loses the
    // GPU device on first present. scripts/run-e2e.mjs provides Xvfb when
    // there is no real display.
    headless: false,
    launchOptions: {
      args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader'],
    },
  },
  webServer: {
    command: 'pnpm dev --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
