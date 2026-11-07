import { execSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@shiply/db';

// Every test run gets its own new database, so tests never touch data that already exists.
const SERVER = process.env.TEST_DATABASE_SERVER ?? 'postgresql://shiply:shiply@localhost:5432';
const NAME = `shiply_test_${Date.now()}_${process.pid}`;
export const TEST_DB = `${SERVER}/${NAME}`;

export async function createTestDatabase() {
  const admin = new PrismaClient({ datasourceUrl: `${SERVER}/postgres` });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${NAME}"`);
  await admin.$disconnect();
  const dbDir = path.resolve(__dirname, '../../../packages/db');
  const env = {
    ...process.env,
    DATABASE_URL: TEST_DB,
    SEED_ADMIN_EMAIL: 'admin@shiply.local',
    SEED_ADMIN_PASSWORD: 'admin12345',
    SEED_DEMO_PASSWORD: 'demo12345',
  };
  execSync('pnpm exec prisma migrate deploy', { cwd: dbDir, env, stdio: 'pipe' });
  execSync('pnpm exec tsx prisma/seed.ts', { cwd: dbDir, env, stdio: 'pipe' });
}

/** Removes only the database this run created. */
export async function dropTestDatabase() {
  if (!/^shiply_test_\d+_\d+$/.test(NAME)) return;
  const admin = new PrismaClient({ datasourceUrl: `${SERVER}/postgres` });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${NAME}" WITH (FORCE)`);
  await admin.$disconnect();
}
