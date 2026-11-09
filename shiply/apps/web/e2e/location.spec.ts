import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, login: string, password: string, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/login/);
  await page.getByLabel('Email or mobile').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a viewer sees the queue but cannot pick', async ({ page }) => {
  await signIn(page, '01012345678', 'viewer-pass-1', '/en/location/queue');
  await expect(page.getByRole('cell', { name: 'الحي السابع' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pick area' })).toHaveCount(0);
});

test('an unclear address is picked from its candidates and leaves the queue', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/location/queue');
  await expect(page.getByRole('cell', { name: 'الحي السابع' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send customer link' })).toBeDisabled();
  await page.getByRole('button', { name: 'Pick area' }).click();
  await page.getByRole('button', { name: 'District 7, Nasr City, Cairo' }).click();
  await expect(page.getByRole('cell', { name: 'الحي السابع' })).toHaveCount(0);
});

test('the finder breaks down one address', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/location/finder');
  await page.getByLabel('Address').fill('ma3adi degla');
  await expect(page.getByTestId('finder-path')).toHaveText('Cairo › Maadi › Degla');
});

test('teaching an unknown word from many addresses places them on the next run', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/location/finder');
  await page.getByRole('tab', { name: 'Many addresses' }).click();
  await page.getByLabel('Addresses').fill('fumfum street 3\nvilla 2 fumfum');
  await page.getByRole('button', { name: 'Run' }).click();
  await page.getByTestId('unknown').getByRole('button', { name: 'Teach' }).first().click();
  await page.getByLabel('Search places').fill('Maadi');
  await page.getByRole('button', { name: 'Cairo › Maadi', exact: true }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('placed-share')).toHaveText('100%');
});

test('sites, a zone and an area make the full chain on the map', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/location/map');
  await page.getByRole('tab', { name: 'Sites' }).click();
  await page.getByLabel('Kind').selectOption('sorting_facility');
  await page.getByLabel('Code').fill('OBR');
  await page.getByLabel('Name', { exact: true }).fill('Obour facility');
  await page.getByLabel('Name in Arabic').fill('مركز فرز العبور');
  await page.getByRole('button', { name: 'Add site' }).click();
  await expect(page.getByRole('cell', { name: 'OBR' })).toBeVisible();
  await page.getByLabel('Kind').selectOption('last_mile_hub');
  await page.getByLabel('Code').fill('MAA');
  await page.getByLabel('Name', { exact: true }).fill('Maadi hub');
  await page.getByLabel('Name in Arabic').fill('مركز المعادي');
  await page.getByLabel('Sorting facility').selectOption({ label: 'OBR · Obour facility' });
  await page.getByRole('button', { name: 'Add site' }).click();
  await page.getByRole('tab', { name: 'Zones' }).click();
  await page.getByLabel('Last mile hub').selectOption({ label: 'MAA · Maadi hub' });
  await page.getByLabel('Code').fill('MAA-A');
  await page.getByLabel('Name', { exact: true }).fill('Maadi A');
  await page.getByLabel('Name in Arabic').fill('المعادي أ');
  await page.getByRole('button', { name: 'Add zone' }).click();
  await page.getByRole('tab', { name: 'Areas' }).click();
  await page.getByLabel('Search areas').fill('Maadi');
  const row = page.getByTestId('row').filter({ hasText: /^Maadi/ }).first();
  await row.getByLabel('Zone').selectOption({ label: 'MAA-A · Maadi A' });
  await expect(row).toContainText('OBR');
});

test('picking an address someone else already placed says so', async ({ page }) => {
  const { createDb } = await import('@shiply/db');
  const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/shiply_test');
  const d = await db.addressDecision.create({ data: { service: 'shiply', refType: 'parcel', refId: 'SH-E2E-2', input: 'عند الكشك', status: 'not_found', confidence: 0, method: 'engine', candidates: [] } });
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/location/queue');
  await expect(page.getByRole('cell', { name: 'عند الكشك' })).toBeVisible();
  await db.addressDecision.update({ where: { id: d.id }, data: { resolvedAt: new Date(), placeId: 'maadi', method: 'manual' } });
  await db.$disconnect();
  await page.getByRole('row', { name: /عند الكشك/ }).getByRole('button', { name: 'Pick area' }).click();
  await page.getByLabel('Search places').fill('Maadi');
  await page.getByRole('button', { name: 'Cairo › Maadi', exact: true }).click();
  await expect(page.getByText('Someone already placed this address')).toBeVisible();
});
