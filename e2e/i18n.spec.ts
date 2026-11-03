import { expect, test } from '@playwright/test';

test.describe('language detection', () => {
  test.use({ locale: 'en-US' });

  test('follows an English system language', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1, name: 'Your courses' })).toBeVisible();
    await expect(page.getByTestId('settings-link')).toContainText('Settings');
  });

  test('a manual choice overrides the system language and survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { name: 'DE' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { level: 1, name: 'Deine Kurse' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Deine Kurse' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Sprache' }).getByRole('radio', { name: 'DE' })).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('language detection (German system)', () => {
  test.use({ locale: 'de-DE' });

  test('follows a German system language', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { level: 1, name: 'Deine Kurse' })).toBeVisible();
  });
});
