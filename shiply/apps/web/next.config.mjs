import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const api = process.env.API_URL ?? 'http://localhost:4100';

/** The web app forwards /api/* to the API, so login cookies stay on the web address. */
export default withNextIntl({
  reactStrictMode: true,
  transpilePackages: ['@shiply/shared'],
  // Use the shared rules from their TypeScript source, so dev mode and builds read the same code.
  webpack(config) {
    config.resolve.alias['@shiply/shared'] = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));
    return config;
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
});
