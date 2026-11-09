import { defineConfig } from '@playwright/test';

const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/shiply_test';
const env = { DATABASE_URL: DB, JWT_SECRET: 'e2e-secret', API_PORT: '4199', API_URL: 'http://localhost:4199', NODE_ENV: 'test' };

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 60_000,
  globalSetup: './e2e/setup.ts',
  use: { baseURL: 'http://localhost:3199', trace: 'off' },
  webServer: [
    { command: 'node ../api/dist/main.js', port: 4199, env, reuseExistingServer: false },
    { command: 'npx next build && npx next start -p 3199', port: 3199, env, timeout: 240_000, reuseExistingServer: false },
  ],
});
