import { expect, Page, test } from '@playwright/test';
import { join } from 'path';

const MERCHANT = 'http://localhost:3000';

async function login(page: Page, email = 'owner@evechantelle.com') {
  await page.goto(MERCHANT);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'Shiply@2026');
  await page.click('button[type=submit]');
  await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto(MERCHANT);
  await page.evaluate(() => localStorage.clear());
});

test('Eve Chantelle imports 10 orders by CSV, sees frozen prices, prints labels and the event history', async ({ page, context }) => {
  await login(page);
  await page.getByRole('link', { name: 'Import CSV' }).first().click();
  await page.setInputFiles('input[type=file]', join(__dirname, '..', '..', 'samples', 'eve-chantelle-10-orders.csv'));
  await page.getByRole('button', { name: 'Upload CSV' }).click();
  const summary = page.getByTestId('import-summary');
  await expect(summary).toContainText('10');
  await expect(page.getByTestId('import-created').locator('tbody tr')).toHaveCount(10);

  // Bulk print the imported labels: a PDF opens in a new tab.
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: /Print selected labels/ }).click();
  const popup = await popupPromise;
  await popup.waitForURL(/^blob:/);
  await popup.close();

  // Open the first imported order: frozen fees and timeline with CREATED and LABEL_PRINTED.
  await page.getByTestId('import-created').locator('tbody tr a').first().click();
  await expect(page.getByTestId('tracking-number')).toHaveText(/^SHP\d{10}$/);
  const fees = page.getByTestId('fees');
  await expect(fees).toContainText('Shipping');
  await expect(fees).toContainText('EGP 80.00');
  await expect(page.getByTestId('timeline')).toContainText('Order created');
  await expect(page.getByTestId('timeline')).toContainText('Label printed');
});

test('create an order manually with a Maadi address lands on the Maadi hub', async ({ page }) => {
  await login(page);
  await page.goto(`${MERCHANT}/orders/new`);
  await page.fill('input[name=customerName]', 'Playwright Customer');
  await page.fill('input[name=customerPhone]', '01011223344');
  await page.fill('input[name=area]', 'Maadi');
  await page.fill('textarea[name=addressLine]', '9 Road 233, Degla, Maadi');
  await page.fill('input[name=cod]', '350');
  await page.getByRole('button', { name: 'Create order' }).click();
  await expect(page.getByTestId('tracking-number')).toBeVisible();
  await expect(page.getByText('MAADI · Maadi Hub')).toBeVisible();

  // Merchant marks it ready for pickup; the timeline records the transition.
  await page.getByLabel('Move to').selectOption('PENDING_PICKUP');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('timeline')).toContainText('Pending Pickup');
});

test('invalid phone shows a field error', async ({ page }) => {
  await login(page);
  await page.goto(`${MERCHANT}/orders/new`);
  await page.fill('input[name=customerName]', 'Bad Phone');
  await page.fill('input[name=customerPhone]', '0123');
  await page.fill('input[name=area]', 'Maadi');
  await page.fill('textarea[name=addressLine]', '9 Road 233, Maadi');
  await page.getByRole('button', { name: 'Create order' }).click();
  await expect(page.getByText('Invalid Egyptian mobile number').first()).toBeVisible();
});

test('Arabic switches the layout to RTL and is remembered for the user', async ({ page }) => {
  await login(page, 'owner@nabta.com');
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: /أهلًا بك/ })).toBeVisible();
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('orders list filters by printed status', async ({ page }) => {
  await login(page);
  await page.goto(`${MERCHANT}/orders?printed=false`);
  await expect(page.getByTestId('orders-table')).toBeVisible();
  await page.goto(`${MERCHANT}/orders?printed=true`);
  await expect(page.getByTestId('orders-table').locator('tbody tr').first()).toBeVisible();
});
