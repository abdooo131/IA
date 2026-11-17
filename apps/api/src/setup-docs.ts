import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ACCESS_TOKEN_COOKIE } from '@shiplynow/shared';

/**
 * The OpenAPI docs at /docs, only outside production: a public map of every route helps no
 * customer and helps an attacker. Answers whether they were mounted.
 */
export function setupDocs(app: INestApplication, nodeEnv: string | undefined): boolean {
  if (nodeEnv === 'production') return false;
  const docs = new DocumentBuilder()
    .setTitle('Shiply Now API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addCookieAuth(ACCESS_TOKEN_COOKIE)
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, docs));
  return true;
}
