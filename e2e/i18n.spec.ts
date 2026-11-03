import { expect, test } from '@playwright/test';

test.describe('language detection', () => {
  test.use({ locale: 'en-US' });

  test('follows an English system language', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText('No videos yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Process batch' })).toBeDisabled();
  });

  test('a manual choice overrides the system language and survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: 'DE' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByText('Noch keine Videos')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Noch keine Videos')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Sprache' }).getByRole('radio', { name: 'DE' })).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('language detection (German system)', () => {
  test.use({ locale: 'de-DE' });

  test('follows a German system language', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByText('Noch keine Videos')).toBeVisible();
  });
});
