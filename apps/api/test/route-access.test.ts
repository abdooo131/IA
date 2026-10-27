import type { INestApplication } from '@nestjs/common';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../src/auth/decorators';
import { createTestApp } from './helpers';

/**
 * Every route must say who may call it: @Public (checked another way, for example Shopify's
 * signature) or @Roles. Routes open to any signed in user are listed here on purpose, so a
 * new route can never be left open by accident.
 */
const ANY_SIGNED_IN = new Set(['auth/me', 'photos/:id', 'photos']);

describe('route access', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  it('declares who may call every route', () => {
    const modules = app.get(ModulesContainer);
    const scanner = new MetadataScanner();
    const reflector = new Reflector();
    const open: string[] = [];
    const publicRoutes: string[] = [];
    let checked = 0;
    const controllers = [...modules.values()].flatMap((m) => [...m.controllers.values()]);
    expect(controllers.length).toBeGreaterThan(20);
    for (const wrapper of controllers) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
      const proto = Object.getPrototypeOf(instance) as object;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name] as () => unknown;
        const sub = Reflect.getMetadata(PATH_METADATA, handler);
        if (sub === undefined) continue;
        const paths = Array.isArray(sub) ? sub : [sub];
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, metatype]);
        const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [handler, metatype]);
        for (const p of paths) {
          const route = [base, String(p)].filter(Boolean).join('/').replace(/\/+/g, '/');
          checked++;
          if (isPublic) publicRoutes.push(route);
          else if (!roles?.length && !ANY_SIGNED_IN.has(route)) open.push(route);
        }
      }
    }
    expect(open).toEqual([]);
    // The walk really sees the routes.
    expect(publicRoutes).toEqual(
      expect.arrayContaining(['auth/login', 'shopify/rates/:shopId', 'shopify/proxy/areas']),
    );
    expect(checked).toBeGreaterThan(100);
    // Public routes are only these: sign in, health, coverage and Shopify's signed callbacks.
    for (const route of publicRoutes)
      expect(route).toMatch(/^(auth\/(login|refresh|logout)|health|coverage|shopify\/)/);
  });
});
