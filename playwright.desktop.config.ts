import { defineConfig } from '@playwright/test';

/**
 * Electron tests. Separate from playwright.config.ts (browser tests against `next start`):
 * these launch the desktop app from electron/app, which needs `npm run desktop:build` first.
 * Run with: npm run test:desktop
 */
export default defineConfig({
  testDir: './e2e-desktop',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: { trace: 'retain-on-failure' },
});
