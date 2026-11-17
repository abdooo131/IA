import { execSync } from 'node:child_process';
import path from 'node:path';

export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://shiply:shiply@localhost:5432/shiplynow_test';
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../../../packages/db'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
