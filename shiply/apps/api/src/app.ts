import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { PrismaClient } from '@shiply/db';
import { LocationModule, type Geocoder } from './location';
import { PlatformModule } from './platform';

export interface AppOptions {
  /** a fake Google Maps in tests */
  geocoder?: Geocoder | null;
}

export async function createApp(db: PrismaClient, opts: AppOptions = {}): Promise<INestApplication> {
  @Module({ imports: [PlatformModule.forRoot(db), LocationModule.register({ geocoder: opts.geocoder })] })
  class AppModule {}

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_ENV === 'test' ? false : ['error', 'warn'],
    bodyParser: false,
  });
  // Pasted address files can be large; every other body stays small by its own validation.
  app.useBodyParser('json', { limit: '25mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });
  app.use(cookieParser());
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Shiply API').build());
  SwaggerModule.setup('docs', app, doc);
  return app;
}
