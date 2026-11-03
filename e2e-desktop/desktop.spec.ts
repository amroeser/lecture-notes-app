import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const appDir = path.join(__dirname, '..', 'electron', 'app');

let app: ElectronApplication;
let page: Page;
let userData: string;

async function appOrigin() {
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
  return new URL(page.url()).origin;
}

function whichClaude(): string | null {
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(shell, ['-ilc', 'command -v claude'], { encoding: 'utf8', timeout: 8000 }).trim().split('\n').pop();
    return out && out.startsWith('/') ? out : null;
  } catch {
    return null;
  }
}

test.beforeAll(async () => {
  userData = mkdtempSync(path.join(os.tmpdir(), 'lbs-desktop-'));
  app = await electron.launch({
    args: [appDir],
    env: { ...process.env, LBS_USER_DATA_DIR: userData, LBS_DISABLE_UPDATE_CHECK: '1', LBS_DISABLE_OPEN_EXTERNAL: '1', OPENAI_API_KEY: 'sk-from-shell-must-not-leak' },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

test('starts the local server and shows the start page', async () => {
  await appOrigin();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Deine Kurse|Your courses/);
  expect(await page.evaluate(() => window.lbsDesktop?.isDesktop)).toBe(true);
  // No Node.js in the page.
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
});

test('rejects API calls without the per-launch token', async ({ request }) => {
  const origin = await appOrigin();
  const res = await request.post(`${origin}/api/series-pdf`, { data: {} });
  expect(res.status()).toBe(403);
  // The app itself has the token cookie and reaches the route (400 = validation, not 403).
  const status = await page.evaluate(async () => (await fetch('/api/series-pdf', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status);
  expect(status).toBe(400);

  // OPENAI_API_KEY from the launching shell must not reach the server: only saved settings count.
  const error = await page.evaluate(async () => {
    const res = await fetch('/api/series-summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chapters: [{ videoId: 'V01', fileName: 'a.mp4', chapterMarkdown: '# A' }] }),
    });
    return (await res.json()).error as string;
  });
  expect(error).toMatch(/Missing OPENAI_API_KEY/);
});

test('saves an API key encrypted and never shows it again', async () => {
  const origin = await appOrigin();
  await page.goto(`${origin}/settings`);
  const fakeKey = 'sk-test-desktop-1234567890abcdef';
  await expect(page.getByTestId('secret-openaiApiKey-status')).toContainText(/nicht gesetzt|not set/i);
  await page.getByTestId('secret-openaiApiKey-input').fill(fakeKey);
  await page.getByTestId('settings-save').click();

  // The server restarts and the page reloads with ?saved=1.
  await expect(page).toHaveURL(/\/settings\?saved=1$/, { timeout: 60_000 });
  await expect(page.getByTestId('settings-saved')).toBeVisible();
  await expect(page.getByTestId('secret-openaiApiKey-status')).toContainText(/^(gesetzt|set)$/i);
  expect(await page.content()).not.toContain(fakeKey);

  const file = readFileSync(path.join(userData, 'settings.json'), 'utf8');
  expect(file).not.toContain(fakeKey);
  expect(JSON.parse(file).secrets.openaiApiKey).toEqual(expect.any(String));
});

test('shows whether the Claude Code and Codex CLIs are installed', async () => {
  const origin = await appOrigin();
  await page.goto(`${origin}/settings`);
  const claude = whichClaude();
  const status = page.getByTestId('cli-claude-status');
  if (claude) {
    await expect(status).toContainText(/Claude Code|\d+\.\d+/);
    await expect(page.getByTestId('cli-claude-path')).toContainText(claude);
  } else {
    await expect(status).toContainText(/nicht gefunden|not found/i);
  }
  await expect(page.getByTestId('cli-codex-status')).toBeVisible();
});

test('opens external links in the system browser, not in the app', async () => {
  const origin = await appOrigin();
  await page.goto(`${origin}/settings`);
  const before = page.url();
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.href = 'https://example.com/';
    document.body.appendChild(a);
    a.click();
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);
});
