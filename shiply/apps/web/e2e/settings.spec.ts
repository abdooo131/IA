import { expect, test, type Page } from '@playwright/test';
import { createDb } from '@shiply/db';

async function signIn(page: Page, login: string, password: string, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/login/);
  await page.getByLabel(/Email or mobile|البريد/).fill(login);
  await page.getByLabel(/^Password$|كلمة المرور/).fill(password);
  await page.getByRole('button', { name: /Sign in|دخول/ }).click();
}

test('owner creates a user with an Arabic digits mobile, and the list shows it normalized', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/settings/users');
  await page.getByRole('link', { name: 'New user' }).click();
  await expect(page.getByRole('heading', { name: 'New user' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Viewer' })).toHaveCount(1);
  await page.getByLabel('Name', { exact: true }).fill('Sara');
  await page.getByLabel('Name in Arabic').fill('سارة');
  await page.getByLabel('Mobile').fill('٠١١٢٣٤٥٦٧٨٩');
  await page.getByLabel('Job role').selectOption({ label: 'Viewer' });
  await page.getByLabel('Password').fill('sara-pass-1');
  await page.getByRole('button', { name: 'Create user' }).click();
  await page.waitForURL(/\/en\/settings\/users\/[a-z0-9]+$/);
  await expect(page.getByText('+201123456789')).toBeVisible();
  await page.goto('/en/settings/users');
  await expect(page.getByRole('cell', { name: '+201123456789' })).toBeVisible();
});

test('a viewer sees users but cannot add one', async ({ page }) => {
  await signIn(page, '01123456789', 'sara-pass-1', '/en/settings/users');
  await expect(page.getByRole('heading', { name: 'Users & access' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New user' })).toHaveCount(0);
  await page.goto('/en/settings/users/new');
  await expect(page.getByTestId('no-access')).toBeVisible();
});

test('the audit log speaks plain English and Arabic', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/settings/audit');
  await expect(page.getByRole('cell', { name: 'User created' }).first()).toBeVisible();
  await page.goto('/ar/settings/audit');
  await expect(page.getByRole('cell', { name: 'تم إنشاء مستخدم' }).first()).toBeVisible();
});

test('a dead event is listed and Retry sends it again', async ({ page }) => {
  const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/shiply_test');
  await db.outboxEvent.create({
    data: { id: 'ev-e2e', type: 'test.broken', payload: {}, key: 'ev-e2e', deliveries: { create: { handler: 'nobody', status: 'dead', attempts: 5, lastError: 'handler down' } } },
  });
  await db.$disconnect();
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/settings/dead-letters');
  await expect(page.getByRole('cell', { name: 'handler down' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('cell', { name: 'handler down' })).toHaveCount(0);
});

test('login never sends the user to another site', async ({ page }) => {
  await page.goto('/en/login?next=%2F%5Cevil.com');
  await page.getByLabel('Email or mobile').fill('owner@test.local');
  await page.getByLabel('Password').fill('owner-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/localhost:3199\/en$/);
});

test('a record that does not exist says so instead of a blank page', async ({ page }) => {
  await signIn(page, 'owner@test.local', 'owner-pass-1', '/en/settings/users/does-not-exist');
  await expect(page.getByTestId('load-error')).toContainText('could not be found');
});
