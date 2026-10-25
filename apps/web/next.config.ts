import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// One .env for the whole monorepo, at the repo root. Next has already looked for env files
// in apps/web by the time this runs, so force a reload from the root. Real environment
// variables (staging, production, CI) always win over the file.
loadEnvConfig(
  path.resolve(__dirname, '../..'),
  process.env.NODE_ENV !== 'production',
  console,
  true,
);

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lets phones open the dev server through a tunnel (for camera testing over https).
  allowedDevOrigins: ['*.trycloudflare.com'],
  // The browser only ever talks to the web origin; /api is proxied to the NestJS API so
  // the auth cookies stay first party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
