/**
 * README captures from the real desktop app (settings and library inside the Electron window).
 * Skipped unless LBS_MEDIA=1:  npm run desktop:build && LBS_MEDIA=1 npm run test:desktop -- media
 * Writes docs/media/desktop-*.png. No real keys are used; the course data is fixture data.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { lectures, seriesMarkdown, guardrailReport } from '../e2e/fixtures';

test.skip(!process.env.LBS_MEDIA, 'README media capture runs only with LBS_MEDIA=1');

const appDir = path.join(__dirname, '..', 'electron', 'app');
const OUT = path.join(__dirname, '..', 'docs', 'media');
mkdirSync(OUT, { recursive: true });

let app: ElectronApplication;
let page: Page;
let userData: string;

const courses: Array<{ title: string; done: number; failed?: number; series: boolean }> = [
  { title: 'Statistik I – Wintersemester', done: 3, series: true },
  { title: 'Makroökonomie: Konjunktur & Geldpolitik', done: 2, failed: 1, series: false },
  { title: 'Organic Chemistry II', done: 1, series: false },
];

async function settle() {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

async function useLook(locale: 'de' | 'en', scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.evaluate((l) => localStorage.setItem('lbs.locale', l), locale);
}

/** Never publish the local user name: show CLI paths relative to ~. */
async function anonymizePaths() {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue && /\/(Users|home)\/[^/\s]+/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/\/(Users|home)\/[^/\s]+/g, '~');
    }
  });
}

test.beforeAll(async () => {
  userData = mkdtempSync(path.join(os.tmpdir(), 'lbs-media-'));
  app = await electron.launch({
    args: [appDir],
    env: { ...process.env, LBS_USER_DATA_DIR: userData, LBS_DISABLE_UPDATE_CHECK: '1', LBS_DISABLE_OPEN_EXTERNAL: '1' },
  });
  page = await app.firstWindow();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
  const win = await app.browserWindow(page);
  await win.evaluate((w) => {
    w.setContentSize(1280, 820);
    w.center();
  });

  // Seed the library through the app's own API (the per-launch token cookie is already set).
  await page.evaluate(
    async ({ courses, lectures, md, report }) => {
      for (const c of courses) {
        const res = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: c.title }) });
        const { course } = (await res.json()) as { course: { id: string } };
        for (let i = 0; i < c.done; i++) {
          const l = lectures[i];
          const videoId = `V0${i + 1}`;
          await fetch(`/api/library/${course.id}/lectures/${videoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoId,
              fileName: l.file,
              sizeBytes: 180_000_000 + i * 23_000_000,
              status: 'done',
              chapterTitle: l.title,
              chapterMarkdown: l.markdown,
              transcript: `Transkript von ${l.title} …`,
            }),
          });
        }
        for (let i = c.done; i < c.done + (c.failed ?? 0); i++) {
          const videoId = `V0${i + 1}`;
          await fetch(`/api/library/${course.id}/lectures/${videoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoId, fileName: `vorlesung-0${i + 1}.mp4`, sizeBytes: 210_000_000, status: 'error', error: 'Rate limit reached (step: transcribe)' }),
          });
        }
        if (c.series) {
          await fetch(`/api/library/${course.id}/series`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seriesMarkdown: md, guardrailReport: report }),
          });
        }
      }
    },
    { courses, lectures, md: seriesMarkdown(), report: guardrailReport() },
  );
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

for (const locale of ['en', 'de'] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`desktop captures (${locale}, ${scheme})`, async () => {
      await useLook(locale, scheme);

      await page.goto(new URL('/', page.url()).toString());
      await expect(page.getByTestId('course-card')).toHaveCount(courses.length);
      await page.waitForTimeout(300);
      await settle();
      await page.screenshot({ path: path.join(OUT, `desktop-library-${locale}-${scheme}.png`) });

      await page.goto(new URL('/settings', page.url()).toString());
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Show the subscription option selected (not saved): status of the installed Claude Code CLI.
      await page.getByRole('radio', { name: /Claude Code/ }).check({ force: true });
      await page.waitForTimeout(600);
      await anonymizePaths();
      // Scroll so the text-provider section with the CLI status is in view; the save bar stays pinned below.
      await page.getByText(/Codex CLI/).last().scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 160));
      await settle();
      await page.screenshot({ path: path.join(OUT, `desktop-settings-${locale}-${scheme}.png`) });
    });
  }
}
