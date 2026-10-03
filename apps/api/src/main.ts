import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function main() {
  for (const k of ['DATABASE_URL', 'JWT_ACCESS_SECRET']) {
    if (!process.env[k]) throw new Error(`${k} is not set`);
  }
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = parseInt(process.env.PORT ?? '4000', 10);
  await app.listen(port);
  console.log(`Shiply API listening on http://localhost:${port}/api`);
}
main();
