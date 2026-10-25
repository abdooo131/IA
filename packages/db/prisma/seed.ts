import { PrismaClient } from '@prisma/client';
import { passwordSchema } from '@shiplynow/shared';
import { hashPassword } from '../src/password';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? 'Shiply Admin';
  if (!email || !password) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env before seeding');
  }
  passwordSchema.parse(password);

  // Upsert keeps the seed safe to run twice; an existing admin keeps their current password.
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: 'admin', isActive: true },
    create: { email, name, role: 'admin', passwordHash: await hashPassword(password) },
  });
  console.log(`Admin ready: ${admin.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
