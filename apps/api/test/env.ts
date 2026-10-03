// Integration tests run against a throwaway database created by global-setup.ts for this run only.
const db = process.env.SHIPLY_TEST_DB ?? 'shiply_test';
const appBase = process.env.TEST_APP_DB_BASE ?? 'postgresql://shiply_app:shiply_app@localhost:5432';
const ownerBase = process.env.TEST_OWNER_DB_BASE ?? 'postgresql://postgres:postgres@localhost:5432';
process.env.DATABASE_URL = `${appBase}/${db}`;
process.env.MIGRATE_DATABASE_URL = `${ownerBase}/${db}`;
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
// Empty (not deleted) so neither dotenv nor Prisma's .env loading can bring Redis back: jobs run in process.
process.env.REDIS_URL = '';
export {};
