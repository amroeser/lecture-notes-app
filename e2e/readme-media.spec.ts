/**
 * Generates the screenshots and the demo video used in README.md.
 *   npm run media          # writes docs/media/*.png and docs/media/raw/demo-*.webm
 *   scripts/build-media.sh # converts the recordings to MP4 + GIF
 * The OpenAI-backed routes are mocked, the PDF route runs for real.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { fakeVideo, lectures, mockApi, seriesMarkdown, seriesTitle } from './fixtures';

const OUT = path.join(process.cwd(), 'docs', 'media');
const RAW = path.join(OUT, 'raw');
mkdirSync(RAW, { recursive: true });

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const locales = [
  { id: 'en', locale: 'en-US' },
  { id: 'de', locale: 'de-DE' },
] as const;

/** Visible cursor + click ripple, because headless recordings do not show the pointer. */
const cursorScript = () => {
  const style = document.createElement('style');
  style.textContent = `
    #pw-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;
      transition:transform .12s ease;filter:drop-shadow(0 2px 3px rgb(0 0 0/.35))}
    #pw-cursor.down{transform:scale(.85)}
    .pw-ripple{position:fixed;z-index:2147483646;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;
      background:rgb(79 70 229/.35);pointer-events:none;animation:pw-r .5s ease-out forwards}
    @keyframes pw-r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}`;
  const cursor = document.createElement('div');
  cursor.id = 'pw-cursor';
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const mount = () => {
    document.head.appendChild(style);
    document.body.appendChild(cursor);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
  addEventListener('mousemove', (e) => {
    cursor.style.left = `${e.clientX}px`;
    cursor.style.top = `${e.clientY}px`;
  });
  addEventListener('mousedown', (e) => {
    cursor.classList.add('down');
    const r = document.createElement('div');
    r.className = 'pw-ripple';
    r.style.left = `${e.clientX}px`;
    r.style.top = `${e.clientY}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 600);
  });
  addEventListener('mouseup', () => cursor.classList.remove('down'));
};

async function glide(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('target not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
}

async function smoothScrollTo(page: Page, target: Locator, offset = 24) {
  await target.evaluate((el, off) => {
    const top = el.getBoundingClientRect().top + window.scrollY - off;
    window.scrollTo({ top, behavior: 'smooth' });
  }, offset);
  await page.waitForTimeout(900);
}

async function runFlow(page: Page) {
  await page.locator('#series-title').fill(seriesTitle);
  await page.getByTestId('file-input').setInputFiles(lectures.map((l) => fakeVideo(l.file, 1 + lectures.indexOf(l) * 0.4)));
  await expect(page.getByTestId('series-preview')).toBeVisible({ timeout: 30_000 });
}

for (const { id, locale } of locales) {
  test(`screenshots (${id})`, async ({ browser }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const ctx = await browser.newContext({ locale, colorScheme, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: false });
      const page = await ctx.newPage();
      await mockApi(page);
      await page.goto('/');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `empty-${id}-${colorScheme}.png`) });
      await runFlow(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `overview-${id}-${colorScheme}.png`) });
      const output = page.getByTestId('series-preview').locator('xpath=ancestor::section[1]');
      await output.screenshot({ path: path.join(OUT, `preview-${id}-${colorScheme}.png`) });
      await ctx.close();
    }

    const mobile = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const m = await mobile.newPage();
    await mockApi(m);
    await m.goto('/');
    await runFlow(m);
    await m.evaluate(() => window.scrollTo(0, 0));
    await m.waitForTimeout(300);
    await m.screenshot({ path: path.join(OUT, `mobile-${id}.png`) });
    await mobile.close();
  });

  test(`demo video (${id})`, async ({ browser }) => {
    const size = { width: 1280, height: 800 };
    const ctx = await browser.newContext({ locale, colorScheme: 'light', viewport: size, recordVideo: { dir: RAW, size }, acceptDownloads: false });
    await ctx.addInitScript(cursorScript);
    const page = await ctx.newPage();
    // Turn off auto-downloads in the recording; they would pop browser chrome in real use.
    await mockApi(page, { lectureDelay: 1600, seriesDelay: 1800 });
    await page.goto('/');
    await page.mouse.move(size.width / 2, 120);
    await page.waitForTimeout(900);

    await glide(page, page.locator('#series-title'));
    await page.mouse.down();
    await page.mouse.up();
    await page.locator('#series-title').pressSequentially(seriesTitle, { delay: 45 });
    await page.waitForTimeout(300);

    const pick = page.getByTestId('file-input').locator('xpath=..').locator('button');
    await glide(page, pick);
    await page.mouse.down();
    await page.mouse.up();
    await page.getByTestId('file-input').setInputFiles(lectures.map((l, i) => fakeVideo(l.file, 1 + i * 0.4)));

    await glide(page, page.getByTestId('lecture-item').first());
    await expect(page.getByTestId('series-preview')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);

    await smoothScrollTo(page, page.getByTestId('series-preview').locator('xpath=ancestor::section[1]'));
    await glide(page, page.getByTestId('series-preview'));
    await page.getByTestId('series-preview').evaluate((el) => el.scrollTo({ top: 520, behavior: 'smooth' }));
    await page.waitForTimeout(1500);

    const tabs = page.getByRole('tab');
    await glide(page, tabs.nth(2));
    await tabs.nth(2).click();
    await page.waitForTimeout(1400);
    await glide(page, tabs.nth(0));
    await tabs.nth(0).click();
    await page.waitForTimeout(1200);

    const video = page.video();
    await ctx.close();
    await video?.saveAs(path.join(RAW, `demo-${id}.webm`));
    await video?.delete();
  });
}

test('sample PDF page', async ({ request }) => {
  const res = await request.post('/api/series-pdf', { data: { seriesTitle, seriesMarkdown: seriesMarkdown() } });
  expect(res.ok()).toBe(true);
  const pdf = path.join(RAW, 'sample.pdf');
  writeFileSync(pdf, await res.body());
  if (process.platform === 'darwin') {
    // sips renders the first page only, which is all the README needs.
    execFileSync('sips', ['-s', 'format', 'png', '-Z', '1400', pdf, '--out', path.join(OUT, 'pdf-page.png')]);
  }
});
