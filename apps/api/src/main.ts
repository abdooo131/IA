import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ACCESS_TOKEN_COOKIE } from '@shiplynow/shared';
import { AppModule } from './app.module';
import type { Env } from './config/env';
import { setupApp } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupApp(app);

  const docs = new DocumentBuilder()
    .setTitle('Shiply Now API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addCookieAuth(ACCESS_TOKEN_COOKIE)
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, docs));

  const port = app.get<ConfigService<Env, true>>(ConfigService).get('API_PORT', { infer: true });
  // In the single container (deploy/start.mjs) the API listens only inside it, so the host's
  // port detection sees just the web app. Locally it listens everywhere as before.
  const host = process.env.API_HOST;
  await (host ? app.listen(port, host) : app.listen(port));
  console.log(`Shiply Now API on http://localhost:${port} (docs at /docs)`);
}

void bootstrap();
