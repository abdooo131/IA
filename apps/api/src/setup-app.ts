import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { raw } from 'express';
import { DomainErrorFilter } from './common/domain-error.filter';
import type { Env } from './config/env';

/** Shared by main.ts and the tests so both run the same middleware. */
export function setupApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.use(cookieParser());
  // Photos are uploaded as the raw image body (the client shrinks them first).
  app.use('/photos', raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '1600kb' }));
  app.useGlobalFilters(new DomainErrorFilter());
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.enableShutdownHooks();
}
