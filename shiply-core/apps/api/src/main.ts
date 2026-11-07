import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  app.use(cookieParser());
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '2mb' });
  return app;
}

async function main() {
  const app = await createApp();
  const port = Number(process.env.API_PORT ?? 4100);
  await app.listen(port);
  console.log(`Shiply Core API on http://localhost:${port}`);
}

if (require.main === module) void main();
