import { INestApplication } from '@nestjs/common';

/** Shared HTTP setup for main.ts and integration tests. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
  });
  // JSON responses never carry BigInt ids raw.
  (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
    return this.toString();
  };
}
