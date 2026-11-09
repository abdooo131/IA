import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, login: string, password: string, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/login/);
  await page.getByLabel('Email or mobile').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a new merchant, its contract written by one admin and approved by another', async ({ page, browser }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/merchants/new');
  await page.getByLabel('Brand name').fill('Eve Chantelle');
  await page.getByLabel('Contact person').fill('Mona');
  await page.getByLabel('Contact phone').fill('01012345678');
  await page.getByRole('checkbox', { name: 'Shiply', exact: true }).check();
  await page.getByLabel('Pickup address').fill('شارع 9 المعادي الجديدة');
  await page.getByRole('button', { name: 'Create merchant' }).click();
  await expect(page.getByText('Cairo › Maadi › New Maadi')).toBeVisible();

  await page.getByRole('tab', { name: 'Contract and prices' }).click();
  await page.getByRole('button', { name: 'New draft' }).click();
  await page.getByLabel('Greater Cairo · Medium').fill('50');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByTestId('version-status')).toHaveText('Waiting for approval');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  const url = page.url();

  const other = await browser.newPage();
  await signIn(other, 'second@test.local', 'second-pass-1', url.replace(/^https?:\/\/[^/]+/, ''));
  await other.getByRole('button', { name: 'Approve' }).click();
  await other.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(other.getByTestId('version-status')).toHaveText('Active');
});

test('a waiting sign up is approved', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/merchants/signups');
  const row = page.getByTestId('row').filter({ hasText: 'Waiting Shop' });
  await row.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('row').filter({ hasText: 'Waiting Shop' })).toHaveCount(0);
});

test('a merchant login cannot open the office Merchants app', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/merchants/list');
  await page.getByTestId('row').filter({ hasText: 'Eve Chantelle' }).first().click();
  await page.getByRole('tab', { name: 'Users' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Eve Owner');
  await page.getByLabel('Name in Arabic').fill('إيف');
  await page.getByLabel('Email').fill('eve@shop.test');
  await page.getByLabel('Password').fill('eve-pass-123');
  await page.getByRole('button', { name: 'Add login' }).click();
  await expect(page.getByText('eve@shop.test')).toBeVisible();
  await page.context().clearCookies();
  await signIn(page, 'eve@shop.test', 'eve-pass-123', '/en/merchants/list');
  await expect(page.getByTestId('no-access')).toBeVisible();
});
