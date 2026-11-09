import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/login/);
  await page.getByLabel('Email or mobile').fill('owner@test.local');
  await page.getByLabel('Password').fill('owner-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a new parcel gets its zone, hub and price from the address', async ({ page }) => {
  await signIn(page, '/en/shiply/parcels/new');
  await page.getByLabel('Merchant', { exact: true }).selectOption({ label: 'Eve Store · EVE' });
  await page.getByLabel('Customer name').fill('Sara');
  await page.getByLabel('Customer phone').fill('0100 123 4567');
  await page.getByLabel('Address').fill('روكسي مصر الجديدة');
  await page.getByLabel('Size').selectOption('small');
  await page.getByLabel('Cash on delivery').fill('250');
  await page.getByRole('button', { name: 'Create parcel' }).click();
  await expect(page.getByRole('heading', { name: /^SP\d{10}$/ })).toBeVisible();
  await expect(page.getByTestId('parcel-route')).toContainText('HEL-A');
  await expect(page.getByTestId('parcel-route')).toContainText('HLF');
  await expect(page.getByTestId('parcel-price')).toHaveText('EGP 45.00');
  await expect(page.getByTestId('parcel-now')).toContainText('At the merchant: Eve Store');
});

test('inbound shows expected against received, and closing a car flags what never arrived', async ({ page }) => {
  await signIn(page, '/en/shiply/inbound');
  await page.getByLabel('Site').selectOption({ label: 'HLF · Helio facility' });
  const car = page.getByTestId('row').filter({ hasText: 'Karim' });
  await expect(car).toContainText('Eve Store');
  await expect(car.getByTestId('expected')).toHaveText('1');
  await expect(car.getByTestId('received')).toHaveText('0');
  await car.getByRole('button', { name: 'Close car' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await page.goto('/en/shiply/gaps');
  await expect(page.getByTestId('row').filter({ hasText: 'SP1000000009' })).toContainText('Missing');
  await page.goto('/en');
  await expect(page.getByText('1 parcel gaps need a look')).toBeVisible();
});

test('dispatch suggests the courier who covers the zone and starts his run', async ({ page }) => {
  await signIn(page, '/en/shiply/runs');
  await page.getByLabel('Hub').selectOption({ label: 'HEL · Helio hub' });
  await page.getByLabel('Zone').selectOption({ label: 'HEL-A · Helio A' });
  const s = page.getByTestId('suggestion').filter({ hasText: 'Karim' });
  await s.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByTestId('row').filter({ hasText: 'Karim' })).toContainText('Open');
});
