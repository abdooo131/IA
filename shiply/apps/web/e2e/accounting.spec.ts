import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, login: string, password: string, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/login/);
  await page.getByLabel('Email or mobile').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('cash handed over short shows against the courier and on Home', async ({ page, browser }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/accounting/holders');
  await page.getByLabel('Kind').selectOption('hub_safe');
  await page.getByLabel('Name', { exact: true }).fill('Maadi hub safe');
  await page.getByLabel('Name in Arabic').fill('خزنة المعادي');
  await page.getByLabel('Belongs to company').selectOption('shiply');
  await page.getByRole('button', { name: 'Add holder' }).click();
  await expect(page.getByRole('cell', { name: 'Maadi hub safe' })).toBeVisible();

  await page.goto('/en/accounting/handovers');
  await page.getByLabel('From').selectOption({ label: 'Omar · EGP 1,000.00' });
  await page.getByLabel('To').selectOption({ label: 'Maadi hub safe · EGP 0.00' });
  await page.getByLabel('Amount').fill('1,000');
  await page.getByRole('button', { name: 'Hand over' }).click();
  await expect(page.getByTestId('row').filter({ hasText: 'Omar' })).toContainText('Pending');

  const other = await browser.newPage();
  await signIn(other, 'second@test.local', 'second-pass-1', '/en/accounting/handovers');
  const row = other.getByTestId('row').filter({ hasText: 'Pending' }).first();
  await row.getByLabel('Received amount').fill('٩٥٠');
  await row.getByRole('button', { name: 'Confirm received' }).click();
  await expect(other.getByTestId('row').filter({ hasText: 'Omar' }).first()).toContainText('Short');
  await other.goto('/en');
  await expect(other.getByText('1 handovers were short')).toBeVisible();
});

test('a payout is prepared by one person, approved by another, then paid', async ({ page, browser }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/accounting/wallets');
  await expect(page.getByTestId('row').filter({ hasText: 'Nile Pantry' })).toContainText('1,424.40');
  await page.goto('/en/accounting/payouts');
  await page.getByLabel('Merchant', { exact: true }).selectOption({ label: 'Nile Pantry · NILE' });
  await page.getByLabel('Paid by company').selectOption('shiply_now');
  await page.getByLabel('Amount').fill('100');
  await page.getByRole('button', { name: 'Prepare payout' }).click();
  const mine = page.getByTestId('row').filter({ hasText: 'Nile Pantry' }).first();
  await expect(mine).toContainText('Draft');
  await expect(mine.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  const other = await browser.newPage();
  await signIn(other, 'second@test.local', 'second-pass-1', '/en/accounting/payouts');
  const row = other.getByTestId('row').filter({ hasText: 'Nile Pantry' }).first();
  await row.getByRole('button', { name: 'Approve' }).click();
  await other.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(row).toContainText('Approved');
  await row.getByLabel('Payment reference').fill('TRX-77');
  await row.getByLabel('Pay from').selectOption({ label: 'CIB Shiply Now' });
  await row.getByRole('button', { name: 'Mark paid' }).click();
  await expect(row).toContainText('Paid');
});

test('profit and loss for one company shows only that company', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/accounting/profit-and-loss');
  await page.getByLabel('Company').selectOption('shiply');
  await expect(page.getByTestId('pnl-income')).toHaveText('EGP 30.00');
  await expect(page.getByRole('cell', { name: 'Parcel shipping' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Delivery and service fees' })).toHaveCount(0);
});
