import { expect, test } from '@playwright/test';

const OPS = 'http://localhost:3001';

test('ops sees all merchants and can edit a system config value', async ({ page }) => {
  await page.goto(OPS);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${OPS}/orders`);
  await page.fill('input[name=email]', 'ops@shiply.eg');
  await page.fill('input[name=password]', 'Shiply@2026');
  await page.click('button[type=submit]');
  await expect(page.getByTestId('orders-table')).toBeVisible();

  await page.goto(`${OPS}/admin/config`);
  const row = page.locator('[data-config-key="orders.csv_max_rows"]');
  await row.getByRole('button', { name: 'Edit' }).click();
  await row.locator('input').first().fill('2500');
  await row.getByPlaceholder('Reason').fill('playwright');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('2500');
  await row.getByRole('button', { name: 'Edit' }).click();
  await row.locator('input').first().fill('2000');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('2000');

  await page.goto(`${OPS}/admin/audit`);
  await expect(page.getByText('system_config.update').first()).toBeVisible();
});

test('a merchant account cannot sign in to ops', async ({ page }) => {
  await page.goto(OPS);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${OPS}/orders`);
  await page.fill('input[name=email]', 'owner@evechantelle.com');
  await page.fill('input[name=password]', 'Shiply@2026');
  await page.click('button[type=submit]');
  await expect(page.getByText('This account cannot sign in to the ops app')).toBeVisible();
});
