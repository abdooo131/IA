import { defineConfig } from 'vitest/config';

// These tests run against a real Postgres with PostGIS. They use TEST_DATABASE_URL (never
// DATABASE_URL) because every test file wipes the tables.
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://shiply:shiply@localhost:5432/shiplynow_test';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    env: { DATABASE_URL: testDatabaseUrl },
  },
});
