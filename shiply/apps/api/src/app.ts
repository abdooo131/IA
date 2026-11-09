import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { PrismaClient } from '@shiply/db';
import { LocationModule } from './location';
import { PlatformModule } from './platform';

export async function createApp(db: PrismaClient): Promise<INestApplication> {
  @Module({ imports: [PlatformModule.forRoot(db), LocationModule] })
  class AppModule {}

  const app = await NestFactory.create(AppModule, { logger: process.env.NODE_ENV === 'test' ? false : ['error', 'warn'] });
  app.use(cookieParser());
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Shiply API').build());
  SwaggerModule.setup('docs', app, doc);
  return app;
}
