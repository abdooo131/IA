import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// The API suite talks to a real Postgres. It uses TEST_DATABASE_URL (never DATABASE_URL)
// because the test setup wipes every table it touches.
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://shiply:shiply@localhost:5432/shiplynow_test';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      JWT_ACCESS_SECRET: 'test-only-secret-not-used-anywhere-else-0123456789',
      ACCESS_TOKEN_TTL_SECONDS: '900',
      REFRESH_TOKEN_TTL_DAYS: '30',
      WEB_ORIGIN: 'http://localhost:3000',
      COOKIE_SECURE: 'false',
      SLACK_SIGNING_SECRET: 'test-slack-signing-secret',
      SLACK_BOT_TOKEN: '',
    },
  },
});
