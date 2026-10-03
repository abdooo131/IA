import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { join } from 'path';

export function ownerAdminClient() {
  const base = process.env.TEST_OWNER_DB_BASE ?? 'postgresql://postgres:postgres@localhost:5432';
  return new PrismaClient({ datasourceUrl: `${base}/postgres` });
}

/** Creates a brand new database for this test run, applies migrations and seeds reference data. */
export default async function globalSetup() {
  const name = `shiply_test_${Date.now()}_${process.pid}`;
  process.env.SHIPLY_TEST_DB = name;
  process.env.REDIS_URL = '';
  const admin = ownerAdminClient();
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await admin.$disconnect();

  require('./env');
  execSync('npx prisma migrate deploy', { cwd: join(__dirname, '..'), env: process.env, stdio: 'pipe' });
  const { seed } = require('../prisma/seed');
  await seed({ demoOrders: false, log: false });
}
