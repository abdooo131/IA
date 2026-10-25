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
  await app.listen(port);
  console.log(`Shiply Now API on http://localhost:${port} (docs at /docs)`);
}

void bootstrap();
