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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lets phones open the dev server through a tunnel (for camera testing over https).
  allowedDevOrigins: ['*.trycloudflare.com'],
  // /api is forwarded to the NestJS API by src/app/api/[...path]/route.ts, which reads
  // API_URL at runtime. (A rewrite here would freeze the address at build time.)
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
