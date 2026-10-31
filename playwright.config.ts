import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3219);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    locale: 'de-DE',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /readme-media/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /readme-media/ },
    // Generates the screenshots and videos for README.md. Run with: npm run media
    { name: 'media', testMatch: /readme-media\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Production build: no dev overlay in screenshots, same code path as deployments.
    command: `npm run build && npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { OPENAI_API_KEY: 'sk-e2e-not-used' },
  },
});
