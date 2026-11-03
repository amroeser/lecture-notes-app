import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fakeVideo, lectures, mockApi, seriesTitle } from './fixtures';

const allVideos = () => lectures.map((l) => fakeVideo(l.file));

async function upload(page: Page, files = allVideos()) {
  await page.getByTestId('file-input').setInputFiles(files);
}

test.describe('Lecture Batch Summarizer', () => {
  test('shows the empty state with disabled actions', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Lecture Batch Summarizer' })).toBeVisible();
    await expect(page.getByText('Noch keine Videos')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Batch verarbeiten' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Serie generieren' })).toBeDisabled();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  test('processes a batch end to end and auto-downloads Markdown and PDF', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByLabel('Serientitel').fill(seriesTitle);

    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));

    await upload(page);

    const items = page.getByTestId('lecture-item');
    await expect(items).toHaveCount(3);
    await expect(items.getByText('Fertig')).toHaveCount(3);
    await expect(items.first()).toContainText('V01');
    await expect(items.first()).toContainText('Deskriptive Statistik');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    await expect(page.getByTestId('guardrail-banner')).toContainText('Guardrails OK');
    const preview = page.getByTestId('series-preview');
    await expect(preview.getByRole('heading', { level: 1, name: seriesTitle })).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'Hypothesentests' })).toBeVisible();
    await expect(preview.getByRole('table').first()).toContainText('Median');
    // Internal markers must not leak into the rendered preview.
    await expect(preview).not.toContainText('VID:');

    await expect.poll(() => downloads.sort()).toEqual([expect.stringMatching(/^series-.*\.md$/), expect.stringMatching(/^series-.*\.pdf$/)]);
  });

  test('ignores files that are not MP4', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await upload(page, [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
    await expect(page.getByText('Noch keine Videos')).toBeVisible();
  });

  test('shows a failed lecture and recovers on retry', async ({ page }) => {
    await mockApi(page, { failOnce: [lectures[1].file] });
    await page.goto('/');
    // Keep the series step manual so the retry is the only thing under test.
    await page.getByText('Automatik & Leistung').click();
    await page.getByRole('switch', { name: /Serie automatisch generieren/ }).uncheck({ force: true });
    await upload(page);

    const failed = page.getByTestId('lecture-item').filter({ hasText: 'Fehler' });
    await expect(failed).toHaveCount(1);
    await expect(failed).toContainText('Rate limit reached (step: transcribe)');
    await expect(page.getByTestId('lecture-item').getByText('Fertig')).toHaveCount(2);

    await page.getByRole('button', { name: 'Batch verarbeiten' }).click();
    await expect(page.getByTestId('lecture-item').getByText('Fertig')).toHaveCount(3);
    await expect(page.getByTestId('lecture-item').filter({ hasText: 'Fehler' })).toHaveCount(0);
  });

  test('warns when the guardrails find a missing lecture and skips auto-download', async ({ page }) => {
    await mockApi(page, { missingIds: ['V02'] });
    await page.goto('/');
    let downloaded = false;
    page.on('download', () => (downloaded = true));

    await upload(page);
    await expect(page.getByTestId('guardrail-banner')).toContainText('In der Serie fehlen V02');
    await page.getByRole('tab', { name: 'Guardrails' }).click();
    await expect(page.getByTestId('guardrail-json')).toContainText('"missingIds": [\n    "V02"\n  ]');
    expect(downloaded).toBe(false);
  });

  test('lets the user edit Markdown and merge chapters locally', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await upload(page);
    await expect(page.getByTestId('series-preview')).toBeVisible();

    await page.getByRole('tab', { name: 'Markdown' }).click();
    const editor = page.getByLabel('Serie als Markdown');
    await expect(editor).toHaveValue(/<!--VID:V03-->/);
    await editor.fill('# Eigene Notizen\n\nNur ein Test.');
    await page.getByRole('tab', { name: 'Vorschau' }).click();
    await expect(page.getByTestId('series-preview').getByRole('heading', { name: 'Eigene Notizen' })).toBeVisible();

    await page.getByRole('button', { name: 'Lokal zusammenfügen' }).click();
    await expect(page.getByLabel('Lokal zusammengefügte Kapitel')).toHaveValue(/Lernzusammenfassung \(Batch\)[\s\S]*<!--VID:V01-->/);
  });

  test('clears the list', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await upload(page);
    await expect(page.getByTestId('lecture-item').getByText('Fertig')).toHaveCount(3);
    await page.getByRole('button', { name: 'Liste leeren' }).click();
    await expect(page.getByText('Noch keine Videos')).toBeVisible();
  });

  test('has no horizontal overflow', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await upload(page);
    await expect(page.getByTestId('series-preview')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await mockApi(page);
      await page.goto('/');
      await upload(page);
      await expect(page.getByTestId('series-preview')).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});
