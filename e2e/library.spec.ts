import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createCourse, fakeVideo, lectures, mockApi, openCourse, uniqueTitle } from './fixtures';

/** The library is shared by all parallel tests, so cards are always looked up by their unique title. */
const card = (page: Page, title: string) => page.getByTestId('course-card').filter({ hasText: title });

test.describe('Course library', () => {
  test('shows the empty state when there are no courses', async ({ page }) => {
    await page.route('**/api/library', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: { courses: [] } }) : route.continue(),
    );
    await page.goto('/');
    const empty = page.getByTestId('library-empty');
    await expect(empty).toBeVisible();
    await expect(empty.getByRole('heading', { name: 'Noch keine Kurse' })).toBeVisible();
    await expect(empty.getByRole('listitem')).toHaveCount(3);
    await expect(page.getByTestId('course-card')).toHaveCount(0);
  });

  test('creates a course from the library and opens it', async ({ page }) => {
    const title = uniqueTitle('Analysis');
    await createCourse(page.request); // make sure the header button (not the empty state) is shown
    await page.goto('/');
    await page.getByTestId('new-course').first().click();
    await page.getByLabel('Kurstitel', { exact: true }).fill(title);
    await page.getByRole('button', { name: 'Anlegen' }).click();

    await expect(page).toHaveURL(/\/course\/[A-Za-z0-9_-]+$/);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await page.getByTestId('back-to-library').click();
    await expect(card(page, title)).toContainText('Noch keine Videos');
  });

  test('rejects an empty title', async ({ page }) => {
    await createCourse(page.request);
    await page.goto('/');
    await page.getByTestId('new-course').first().click();
    await page.getByRole('button', { name: 'Anlegen' }).click();
    await expect(page.locator('#new-course-error')).toContainText('Bitte einen Titel eingeben.');
  });

  test('keeps chapters and the series after a reload and continues with V04', async ({ page }) => {
    await mockApi(page);
    const { title } = await openCourse(page);
    await page.getByTestId('file-input').setInputFiles(lectures.map((l) => fakeVideo(l.file)));
    await expect(page.getByTestId('guardrail-banner')).toContainText('Guardrails OK');
    await expect(page.getByTestId('lecture-item').getByText('Fertig')).toHaveCount(3);

    await page.reload();
    const items = page.getByTestId('lecture-item');
    await expect(items).toHaveCount(3);
    await expect(items.getByText('Fertig')).toHaveCount(3);
    await expect(items.nth(1)).toContainText('Grundlagen der Wahrscheinlichkeitsrechnung');
    await expect(page.getByTestId('series-preview').getByRole('heading', { name: 'Hypothesentests' })).toBeVisible();
    await expect(page.getByTestId('guardrail-banner')).toContainText('Guardrails OK');

    // Re-uploading a finished file is ignored, a new file continues the numbering.
    await page.getByTestId('file-input').setInputFiles([fakeVideo(lectures[0].file), fakeVideo('statistik-04-regression.mp4', 0.5)]);
    await expect(items).toHaveCount(4);
    await expect(items.nth(3)).toContainText('V04');
    await expect(items.nth(3)).toContainText('statistik-04-regression.mp4');

    await page.getByTestId('back-to-library').click();
    await expect(card(page, title)).toBeVisible();
    await expect(card(page, title)).toContainText('Serie fertig');
  });

  test('a failed lecture is stored and can be retried by uploading it again', async ({ page }) => {
    await mockApi(page, { failOnce: [lectures[0].file] });
    await openCourse(page);
    await page.getByText('Automatik & Leistung').click();
    await page.getByRole('switch', { name: /Serie automatisch generieren/ }).uncheck({ force: true });
    await page.getByTestId('file-input').setInputFiles([fakeVideo(lectures[0].file)]);
    await expect(page.getByTestId('lecture-item').getByText('Fehler')).toHaveCount(1);

    await page.reload();
    const item = page.getByTestId('lecture-item');
    await expect(item).toContainText('Rate limit reached');
    await expect(item).toContainText('Video erneut hochladen');

    await page.getByTestId('file-input').setInputFiles([fakeVideo(lectures[0].file)]);
    await expect(item).toHaveCount(1);
    await expect(item.getByText('Fertig')).toHaveCount(1);
    await expect(item).toContainText('V01');
  });

  test('renames a course on its card', async ({ page }) => {
    const title = uniqueTitle('Alt');
    const renamed = uniqueTitle('Neu');
    await createCourse(page.request, title);
    await page.goto('/');
    await card(page, title).getByTestId('rename-course').click();
    const input = page.getByRole('textbox', { name: 'Kurstitel', exact: true });
    await input.fill(renamed);
    await input.press('Enter');
    await expect(card(page, renamed)).toBeVisible();
    await expect(card(page, title)).toHaveCount(0);

    await page.reload();
    await expect(card(page, renamed)).toBeVisible();
  });

  test('renames a course from its workspace', async ({ page }) => {
    const renamed = uniqueTitle('Umbenannt');
    await openCourse(page);
    const input = page.getByLabel('Kurstitel', { exact: true });
    await input.fill(renamed);
    await input.press('Enter');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  });

  test('deletes a course only after confirmation', async ({ page }) => {
    const title = uniqueTitle('Löschen');
    await createCourse(page.request, title);
    await page.goto('/');

    await card(page, title).getByTestId('delete-course').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`„${title}“ löschen?`);
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toBeHidden();
    await expect(card(page, title)).toBeVisible();

    await card(page, title).getByTestId('delete-course').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(card(page, title)).toHaveCount(0);
    await page.reload();
    await expect(card(page, title)).toHaveCount(0);
  });

  test('shows a not-found state for unknown courses', async ({ page }) => {
    await page.goto('/course/doesNotExist123');
    await expect(page.getByTestId('course-not-found')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Kurs nicht gefunden' })).toBeVisible();
  });

  test('the API validates input and rejects path tricks', async ({ request }) => {
    expect((await request.post('/api/library', { data: { title: '   ' } })).status()).toBe(400);
    expect((await request.get('/api/library/..%2F..%2Fetc')).status()).toBe(400);
    expect((await request.get('/api/library/abcdefgh1234')).status()).toBe(404);
    const id = await createCourse(request);
    expect((await request.put(`/api/library/${id}/lectures/../x`, { data: {} })).status()).toBeGreaterThanOrEqual(400);
    expect((await request.put(`/api/library/${id}/lectures/X01`, { data: { fileName: 'a.mp4', status: 'done' } })).status()).toBe(400);
    expect((await request.put(`/api/library/${id}/lectures/V01`, { data: { fileName: 'a.mp4', status: 'weird' } })).status()).toBe(400);
    expect((await request.put(`/api/library/${id}/lectures/V01`, { data: { fileName: 'a.mp4', status: 'done', sizeBytes: 3 } })).status()).toBe(200);
    expect((await request.delete(`/api/library/${id}`)).status()).toBe(204);
    expect((await request.delete(`/api/library/${id}`)).status()).toBe(404);
  });

  test('stores parallel lecture results without losing any', async ({ request }) => {
    const id = await createCourse(request);
    const ids = Array.from({ length: 12 }, (_, i) => `V${String(i + 1).padStart(2, '0')}`);
    const results = await Promise.all(
      ids.map((v) => request.put(`/api/library/${id}/lectures/${v}`, { data: { fileName: `${v}.mp4`, status: 'done', sizeBytes: 1 } })),
    );
    expect(results.every((r) => r.ok())).toBe(true);
    const json = (await (await request.get(`/api/library/${id}`)).json()) as { course: { lectures: Array<{ videoId: string }> } };
    expect(json.course.lectures.map((l) => l.videoId)).toEqual(ids);
  });

  test('has no horizontal overflow', async ({ page }) => {
    await createCourse(page.request, uniqueTitle('Ein sehr langer Kurstitel für eine Vorlesungsreihe über Wahrscheinlichkeitsrechnung'));
    await page.goto('/');
    await expect(page.getByTestId('course-card').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await createCourse(page.request);
      await page.goto('/');
      await expect(page.getByTestId('course-card').first()).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
});
