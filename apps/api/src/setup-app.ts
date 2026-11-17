import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { type NextFunction, raw, type Request, type Response } from 'express';
import { HttpAdapterHost } from '@nestjs/core';
import { AppErrorFilter } from './common/domain-error.filter';
import { ErrorReporter } from './common/error-reporter';
import type { Env } from './config/env';

/** Shared by main.ts and the tests so both run the same middleware. */
export function setupApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use(cookieParser());
  // The API only answers JSON: browsers must not sniff, frame or cache what it sends.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    next();
  });
  // Photos are uploaded as the raw image body (the client shrinks them first).
  app.use('/photos', raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '1600kb' }));
  // Employee documents are uploaded as the raw photo or PDF (at most 3 MB).
  app.use(
    [
      /^\/hr\/employees\/[^/]+\/documents$/,
      /^\/me\/employee\/documents$/,
      // HR phase 3: a leave request's note (medical note) and a violation's evidence.
      /^\/(hr|me)\/leave\/requests\/[^/]+\/document$/,
      /^\/hr\/violations\/[^/]+\/evidence$/,
      // HR phase 2: documents added in the new hire wizard.
      /^\/hr\/hire-drafts\/[^/]+\/files$/,
    ],
    raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limit: '3100kb' }),
  );
  // The square employee photo, made on the phone (at most 1 MB).
  app.use(
    [
      /^\/hr\/employees\/[^/]+\/photo$/,
      /^\/me\/employee\/photo$/,
      /^\/hr\/hire-drafts\/[^/]+\/photo$/,
    ],
    raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '1100kb' }),
  );
  // Signed merchant contracts: the raw PDF or photo (at most 5 MB).
  app.use(
    /^\/admin\/merchants\/[^/]+\/contract\/files$/,
    raw({ type: ['image/jpeg', 'image/png', 'application/pdf'], limit: '5200kb' }),
  );
  // A payout's proof of transfer: the raw bank slip, PDF or photo (at most 5 MB).
  app.use(
    /^\/finance\/payouts\/[^/]+\/proof$/,
    raw({ type: ['image/jpeg', 'image/png', 'application/pdf'], limit: '5200kb' }),
  );
  // Receipts and documents chosen in a finance form: a shrunk photo or a PDF (at most 5 MB).
  app.use(
    /^\/finance\/files$/,
    raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limit: '5200kb' }),
  );
  // Bank statement files (Excel or CSV) are read as the raw file.
  app.use('/finance/bank-statements/read', raw({ type: () => true, limit: '5mb' }));
  // Shopify signs the exact bytes it sends, so its callbacks keep the raw body.
  // Slack signs the exact bytes it sends too.
  app.use('/slack', raw({ type: () => true, limit: '1mb' }));
  app.use(
    ['/shopify/fs', '/shopify/webhooks', '/shopify/rates'],
    raw({ type: () => true, limit: '1mb' }),
  );
  app.useGlobalFilters(
    new AppErrorFilter(app.get(HttpAdapterHost).httpAdapter, app.get(ErrorReporter)),
  );
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.enableShutdownHooks();
}
