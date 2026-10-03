import { defineConfig } from '@playwright/test';
import { existsSync } from 'fs';

// Smoke tests drive the real API and web apps. Start them first (see RUN.md) or let webServer start them.
const localChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    launchOptions: existsSync(localChromium) ? { executablePath: localChromium } : {},
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'pnpm --filter @shiply/api start', url: 'http://localhost:4000/api/health', reuseExistingServer: true, timeout: 120_000, cwd: '..' },
    { command: 'pnpm --filter @shiply/merchant start', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000, cwd: '..' },
    { command: 'pnpm --filter @shiply/ops start', url: 'http://localhost:3001', reuseExistingServer: true, timeout: 120_000, cwd: '..' },
  ],
});
