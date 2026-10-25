import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hashPassword, type Role } from '@shiplynow/db';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export async function resetDatabase(prisma: PrismaService) {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE refresh_tokens, users CASCADE');
}

export async function createUser(
  prisma: PrismaService,
  data: { email: string; password: string; role: Role; name?: string; isActive?: boolean },
) {
  return prisma.user.create({
    data: {
      email: data.email,
      name: data.name ?? data.email,
      role: data.role,
      isActive: data.isActive ?? true,
      passwordHash: await hashPassword(data.password),
    },
  });
}

/** Pulls the value of one cookie out of a Set-Cookie header list. */
export function cookieValue(setCookie: string[] | string | undefined, name: string) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const match = list.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0]?.slice(name.length + 1);
}
