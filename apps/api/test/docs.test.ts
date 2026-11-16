import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { setupDocs } from '../src/setup-docs';

/** The OpenAPI docs are a map of every route: never mounted in production. */
describe('OpenAPI docs', () => {
  const appWithDocs = async (nodeEnv: string) => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    setupApp(app);
    const mounted = setupDocs(app, nodeEnv);
    await app.init();
    return { app, mounted };
  };

  it('serves /docs outside production', async () => {
    const { app, mounted } = await appWithDocs('development');
    expect(mounted).toBe(true);
    await request(app.getHttpServer()).get('/docs').expect(200);
    await app.close();
  });

  it('has no /docs in production', async () => {
    const { app, mounted } = await appWithDocs('production');
    expect(mounted).toBe(false);
    const res = await request(app.getHttpServer()).get('/docs');
    expect(res.status).not.toBe(200);
    await request(app.getHttpServer()).get('/docs-json').expect(404);
    await app.close();
  });
});
