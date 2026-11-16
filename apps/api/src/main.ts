import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { Env } from './config/env';
import { setupApp } from './setup-app';
import { setupDocs } from './setup-docs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupApp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // The OpenAPI docs are mounted only outside production.
  const docs = setupDocs(app, config.get('NODE_ENV', { infer: true }));

  const port = config.get('API_PORT', { infer: true });
  // Behind the web app the API only listens inside the machine (API_HOST, set by
  // deploy/start.mjs): a host such as Render scans open ports, and a public API port could be
  // taken for the site. Local development keeps the default (every interface).
  const host = process.env.API_HOST;
  await (host ? app.listen(port, host) : app.listen(port));
  console.log(`Shiply Now API on http://localhost:${port}${docs ? ' (docs at /docs)' : ''}`);
}

void bootstrap();
