import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, login: string, password: string, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/login/);
  await page.getByLabel('Email or mobile').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test('a new courier is approved by a second admin, then blocked by an expired licence', async ({ page, browser }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/fleet/people');
  await page.getByLabel('Agent', { exact: true }).selectOption({ label: 'SWIFT · Swift Couriers' });
  await page.getByLabel('Role').selectOption('delivery');
  await page.getByLabel('Name', { exact: true }).fill('Tamer Nour');
  await page.getByLabel('Name in Arabic').fill('تامر نور');
  await page.getByLabel('Mobile').fill('01277777777');
  await page.getByLabel('Password').fill('tamer-pass-1');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByTestId('row').filter({ hasText: 'Tamer Nour' })).toContainText('Pending');

  const other = await browser.newPage();
  await signIn(other, 'second@test.local', 'second-pass-1', '/en/fleet/people');
  const row = other.getByTestId('row').filter({ hasText: 'Tamer Nour' });
  await row.getByRole('button', { name: 'Approve' }).click();
  await other.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(row).toContainText('Approved');

  await row.click();
  await other.getByLabel('Document').selectOption('driving_licence');
  await other.getByLabel('Number').fill('DL-77');
  await other.getByLabel('Expires').fill('2026-01-01');
  await other.getByRole('button', { name: 'Add document' }).click();
  await expect(other.getByTestId('blocked')).toContainText('Driving licence');
});

test('a settlement is approved by a second admin and becomes a bill once invoiced', async ({ page, browser }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/fleet/settlements');
  await page.getByLabel('Agent', { exact: true }).selectOption({ label: 'SWIFT · Swift Couriers' });
  await page.getByLabel('From').fill(day(-7));
  await page.getByLabel('To').fill(day(-1));
  await page.getByRole('button', { name: 'Prepare settlement' }).click();
  const mine = page.getByTestId('row').filter({ hasText: 'Swift Couriers' }).first();
  await expect(mine).toContainText('EGP 40.00');
  await expect(mine.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  const other = await browser.newPage();
  await signIn(other, 'second@test.local', 'second-pass-1', '/en/fleet/settlements');
  const row = other.getByTestId('row').filter({ hasText: 'Swift Couriers' }).first();
  await row.getByRole('button', { name: 'Approve' }).click();
  await other.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(row).toContainText('Approved');
  await row.getByLabel('Invoice number').fill('INV-9');
  await row.getByRole('button', { name: 'Bill it' }).click();
  await expect(row).toContainText('Billed');
  await other.goto('/en/accounting/bills');
  await expect(other.getByTestId('row').filter({ hasText: 'Swift Couriers' })).toContainText('INV-9');
});

test('the agent manager confirms a request on his own screen', async ({ page }) => {
  await signIn(page, 'adel@swift.local', 'adel-pass-12', '/en');
  await page.waitForURL(/\/agent$/);
  await expect(page.getByTestId('person').filter({ hasText: 'Karim' })).toBeVisible();
  const req = page.getByTestId('request').first();
  await req.getByRole('button', { name: 'Confirm' }).click();
  await expect(req).toContainText('Confirmed');
});
