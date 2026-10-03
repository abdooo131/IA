import { expect, Page, test } from '@playwright/test';

const OPS = 'http://localhost:3001';
const API = 'http://localhost:4000/api';

async function signIn(page: Page, path: string, email = 'ops@shiply.eg') {
  await page.goto(OPS);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${OPS}${path}`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'Shiply@2026');
  await page.click('button[type=submit]');
}

test('operations: pickup, hub scan, transfer, delivery and cash handover from the portal', async ({ page, request }) => {
  // A fresh order from Eve Chantelle to Maadi.
  const eve = await (await request.post(`${API}/auth/login`, { data: { email: 'owner@evechantelle.com', password: 'Shiply@2026', app: 'merchant' } })).json();
  const order = await (
    await request.post(`${API}/orders`, {
      headers: { Authorization: `Bearer ${eve.accessToken}` },
      data: { customerName: 'Ops Flow', customerPhone: '01012121212', governorateCode: 'CAI', area: 'Maadi', addressLine: '3 Road 9, Maadi', codAmount: 30000, type: 'DELIVER' },
    })
  ).json();
  const tn: string = order.trackingNumber;

  // Pickups: assign to Mahmoud and mark picked up.
  await signIn(page, '/operations/pickups');
  await page.getByLabel(`select ${tn}`).check();
  await page.getByTestId('driver-select').selectOption({ label: 'Mahmoud Hassan · CAI-SF' });
  await page.getByRole('button', { name: 'Assign pickup driver' }).click();
  await expect(page.getByTestId('bulk-result')).toContainText('1 done');
  await page.getByLabel(`select ${tn}`).check();
  await page.getByRole('button', { name: 'Mark picked up' }).click();
  await expect(page.getByTestId('bulk-result')).toContainText('1 done');

  // Hub scan at the sorting facility.
  await page.goto(`${OPS}/operations/scan`);
  await page.getByTestId('hub-select').selectOption({ label: 'CAI-SF · Cairo Sorting Facility' });
  await page.getByTestId('scan-input').fill(tn);
  await page.getByTestId('scan-input').press('Enter');
  await expect(page.getByTestId('scan-log')).toContainText('At Sorting Facility');

  // Transfer to Maadi.
  await page.goto(`${OPS}/operations/transfers`);
  await page.getByLabel('From hub').selectOption({ label: 'CAI-SF · Cairo Sorting Facility' });
  await page.getByLabel('To hub').selectOption({ label: 'MAADI · Maadi Hub' });
  await page.getByRole('button', { name: 'New transfer' }).click();
  await page.getByTestId('scan-input').fill(tn);
  await page.getByTestId('scan-input').press('Enter');
  await expect(page.getByTestId('scan-last')).toContainText('Added to manifest');
  await page.getByRole('button', { name: 'Dispatch (vehicle leaves)' }).click();
  await expect(page.getByText('Scan parcels as they arrive at the destination hub')).toBeVisible();
  await page.getByTestId('scan-input').fill(tn);
  await page.getByTestId('scan-input').press('Enter');
  await expect(page.getByTestId('scan-last')).toContainText('Received');

  // Deliveries at Maadi: assign Karim, deliver.
  await page.goto(`${OPS}/operations/deliveries`);
  await page.getByTestId('hub-select').selectOption({ label: 'MAADI · Maadi Hub' });
  await page.getByLabel(`select ${order.id}`).check();
  await page.getByTestId('driver-select').selectOption({ label: 'Karim Mostafa · MAADI' });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByTestId('bulk-result')).toContainText('1 done');
  await page.getByRole('tab', { name: /With drivers/ }).click();
  await page.getByLabel(`select ${order.id}`).check();
  await page.getByTestId('mark-delivered').click();
  await expect(page.getByTestId('bulk-result')).toContainText('1 done');

  // Driver cash: Karim now holds the 300 EGP.
  await page.goto(`${OPS}/operations/cash`);
  const karim = page.getByTestId('driver-cash').locator('section').filter({ hasText: 'Karim Mostafa' });
  await expect(karim).toContainText(tn);
  await karim.getByRole('button', { name: 'Record handover' }).click();
  await expect(page.getByRole('status')).toContainText('Karim Mostafa: Balanced');
});
