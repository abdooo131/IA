import { ownerAdminClient } from './global-setup';

/** Drops only the database this run created (name starts with shiply_test_). */
export default async function globalTeardown() {
  const name = process.env.SHIPLY_TEST_DB;
  if (!name || !name.startsWith('shiply_test_') || process.env.KEEP_TEST_DB) return;
  const admin = ownerAdminClient();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.$disconnect();
}
