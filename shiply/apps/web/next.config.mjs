import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const api = process.env.API_URL ?? 'http://localhost:4100';

/** The web app forwards /api/* to the API, so login cookies stay on the web address. */
export default withNextIntl({
  reactStrictMode: true,
  transpilePackages: ['@shiply/shared'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
});
