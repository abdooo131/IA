import { PrismaClient } from '@prisma/client';
import { seed } from '../src/seed';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env before seeding');
  }
  await seed(prisma, {
    admin: { email, password, name: process.env.SEED_ADMIN_NAME ?? 'Shiply Admin' },
    // Falls back to the admin password so an older .env still works.
    demoPassword: process.env.SEED_DEMO_PASSWORD || password,
    log: (message) => console.log(message),
  });
  console.log(`Admin ready: ${email.trim().toLowerCase()}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
