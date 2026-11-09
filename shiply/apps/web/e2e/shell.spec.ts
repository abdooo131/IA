import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, login: string, password: string, path = '/en') {
  await page.goto(path);
  await page.waitForURL(/\/login/);
  await page.getByLabel(/Email or mobile|البريد/).fill(login);
  await page.getByLabel(/^Password$|كلمة المرور/).fill(password);
  await page.getByRole('button', { name: /Sign in|دخول/ }).click();
}

test('owner signs in and sees the 12 app tiles', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1');
  await expect(page.getByTestId('tile')).toHaveCount(12);
  await expect(page.getByText('Nothing waiting for you')).toBeVisible();
});

test('a wrong password says so', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'nope');
  await expect(page.locator('p[role=alert]')).toHaveText('Wrong email, mobile or password');
});

test('a user sees only the apps they can open, and a clear page for the rest', async ({ page }) => {
  await signIn(page, 'rana@test.local', 'rana-pass-1');
  await expect(page.getByTestId('tile')).toHaveCount(1);
  await page.goto('/en/hr');
  await expect(page.getByTestId('no-access')).toContainText('You do not have access to HR');
});

test('Arabic turns the page right to left and mirrors the menu', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/dev/list');
  await page.waitForURL(/dev\/list/);
  await page.getByTestId('lang').click();
  await page.waitForURL(/\/ar\/dev\/list/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const more = await page.getByTestId('more').boundingBox();
  const first = await page.getByTestId('menu-item').first().boundingBox();
  expect(more!.x).toBeLessThan(first!.x);
});

test('an expired session goes to login and comes back to the same page', async ({ page, context }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/dev/list');
  await page.waitForURL(/dev\/list/);
  await context.clearCookies();
  await page.reload();
  await page.waitForURL(/\/login\?next=%2Fen%2Fdev%2Flist/);
  await page.getByLabel('Email or mobile').fill('owner@test.local');
  await page.getByLabel('Password').fill('owner-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/en\/dev\/list$/);
});

test('a list shows 50 rows a page, and bulk actions ask before they run', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/dev/list');
  await expect(page.getByTestId('row')).toHaveCount(50);
  await expect(page.getByTestId('page-of')).toHaveText('Page 1 of 3');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('row')).toHaveCount(20);
  await page.getByRole('checkbox', { name: 'D101' }).check();
  await page.getByTestId('bulkbar').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('cannot be undone');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
