import { expect, Page, test } from '@playwright/test';

async function signIn(page: Page, base: string, path: string, email: string) {
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}${path}`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'Shiply@2026');
  await page.click('button[type=submit]');
}

test('merchant sees the wallet and requests a Fawry cashout', async ({ page, request }) => {
  // Give the wallet enough money for the test through the finance API (a compensation).
  const API = 'http://localhost:4000/api';
  const fin = await (await request.post(`${API}/auth/login`, { data: { email: 'finance@shiply.eg', password: 'Shiply@2026', app: 'ops' } })).json();
  const auth = { Authorization: `Bearer ${fin.accessToken}` };
  const wallets = await (await request.get(`${API}/finance/wallets`, { headers: auth })).json();
  const eve = wallets.find((w: { code: string }) => w.code === 'EVE');
  await request.post(`${API}/finance/wallets/${eve.id}/adjust`, { headers: auth, data: { kind: 'COMPENSATION', amount: 10000, reason: 'Playwright top up' } });

  await signIn(page, 'http://localhost:3000', '/wallet', 'owner@evechantelle.com');
  await expect(page.getByTestId('wallet-balance')).toContainText('EGP');
  await expect(page.getByTestId('statement')).toContainText('COD collected');
  await page.getByLabel('Fawry account').check();
  await page.fill('#cashout-amount', '50');
  await page.fill('#cashout-destination', '01012345678');
  await expect(page.getByText('You receive')).toBeVisible();
  await page.getByRole('button', { name: 'Request cashout' }).click();
  await expect(page.getByText('Cashout requested')).toBeVisible();
  await expect(page.getByTestId('cashout-history')).toContainText('Fawry account');
});

test('finance approves a cashout, runs the cash cycle and sees a balanced trial balance', async ({ page }) => {
  await signIn(page, 'http://localhost:3001', '/finance/cashouts', 'finance@shiply.eg');
  const table = page.getByTestId('cashouts-table');
  await expect(table.locator('tbody tr').first()).toBeVisible();
  const rows = await table.locator('tbody tr').count();
  await table.getByRole('button', { name: 'Approve and pay' }).first().click();
  await expect(table.locator('tbody tr')).toHaveCount(Math.max(1, rows - 1));

  await page.goto('http://localhost:3001/finance');
  await page.getByRole('button', { name: 'Run cash cycle now' }).click();
  await expect(page.getByText('DONE').first()).toBeVisible();

  await page.goto('http://localhost:3001/finance/reports');
  await expect(page.getByTestId('report-check')).toContainText('Debits equal credits');
  await expect(page.getByTestId('report-check')).toContainText('✓');
  await page.getByRole('tab', { name: 'Balance sheet' }).click();
  await expect(page.getByTestId('report-check')).toContainText('✓ Assets equal liabilities plus equity');
  await page.getByRole('button', { name: 'Excel' }).click();
  await expect(page.getByTestId('exports-list').getByRole('button', { name: 'Download' }).first()).toBeVisible({ timeout: 15000 });
});
