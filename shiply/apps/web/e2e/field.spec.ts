import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, login: string, password: string, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/login/);
  await page.getByLabel('Email or mobile').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const scan = async (page: Page, code: string) => {
  await page.getByLabel('Scan').fill(code);
  await page.getByLabel('Scan').press('Enter');
};

test('the station answers in big letters, refuses a wrong step, and keeps scans while offline', async ({ page, context }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/station');
  await page.getByLabel('Site').selectOption({ label: 'HLF · Helio facility' });
  await page.getByRole('button', { name: 'Sorting', exact: true }).click();
  await scan(page, 'SP2000000001');
  await expect(page.getByTestId('answer')).toHaveText(/HEL/);
  await expect(page.getByTestId('answer')).toHaveAttribute('data-colour', 'green');

  await page.getByRole('button', { name: 'Inbound', exact: true }).click();
  await scan(page, 'SP2000000001');
  await expect(page.getByTestId('answer')).toHaveAttribute('data-colour', 'red');
  await expect(page.getByTestId('answer')).toContainText('already changed');

  await page.getByRole('button', { name: 'Outbound', exact: true }).click();
  await page.getByLabel('Bag seal').fill('E2E-S1');
  await context.setOffline(true);
  await scan(page, 'SP2000000001');
  await scan(page, 'SP2000000001');
  await expect(page.getByTestId('pending')).toHaveText('2 scans waiting to send');
  await context.setOffline(false);
  await expect(page.getByTestId('pending')).toHaveCount(0);
  // the second one was refused once it reached the server: it stays on screen
  await expect(page.getByTestId('refused')).toContainText('SP2000000001');
  const parcel = await (await page.request.get('/api/parcels/SP2000000001')).json();
  expect(parcel.status).toBe('at_outbound');
  expect(parcel.events.filter((e: { status: string }) => e.status === 'at_outbound')).toHaveLength(1);
});

test('a courier delivers and the cash shows on him in Accounting', async ({ page, browser }) => {
  await signIn(page, '01166666666', 'nour-pass-1', '/en');
  await page.waitForURL(/\/courier/);
  const stop = page.getByTestId('stop').filter({ hasText: 'SP4000000003' });
  await expect(stop).toContainText('EGP 250.00');
  await stop.getByLabel('Cash collected').fill('250');
  await stop.getByRole('button', { name: 'Delivered' }).click();
  await expect(stop).toContainText('Delivered');

  await page.getByRole('button', { name: 'Returns', exact: true }).click();
  await scan(page, 'SP5000000004');
  await expect(page.getByTestId('answer')).toHaveAttribute('data-colour', 'green');

  const office = await browser.newPage();
  await signIn(office, 'owner@test.local', 'owner-pass-1', '/en/accounting/holders');
  await office.waitForURL(/\/accounting\/holders/);
  // The cash is booked by the event worker a moment later.
  await expect(async () => {
    await office.reload();
    await expect(office.getByTestId('row').filter({ hasText: 'Nour' })).toContainText('EGP 250.00', { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
});
