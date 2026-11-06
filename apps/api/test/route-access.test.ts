import type { INestApplication } from '@nestjs/common';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_KEY, IS_PUBLIC_KEY, ROLES_KEY } from '../src/auth/decorators';
import { createTestApp } from './helpers';

/**
 * Every route must say who may call it: @Public (checked another way, for example Shopify's
 * signature), @Access (team members by their access profile, docs/ACCESS.md) or @Roles.
 * Routes open to any signed in user are listed here on purpose, so a new route can never be
 * left open by accident.
 */
const ANY_SIGNED_IN = new Set([
  'auth/me',
  'photos/:id',
  'photos',
  'me/access',
  // My HR: a person's own employee file (merchants have none): read, upload a missing
  // document (HR verifies it), their photo; managers see their team without pay.
  'me/employee',
  'me/employee/history',
  'me/employee/documents/:documentId',
  // My attendance: a person's own Clock in, Clock out and days (merchants have no file).
  'me/attendance',
  'me/attendance/clock-in',
  'me/attendance/clock-out',
  'me/employee/documents',
  'me/employee/photo',
  'me/team',
  'me/team/:employeeId',
  // A person's photo: themself, their managers and HR view (checked inside).
  'people/:employeeId/photo',
  // Notifications: a person's own devices, switches and test (each call touches only their rows).
  'me/push/',
  'me/push/subscriptions',
  'me/push/subscriptions/remove',
  'me/push/subscriptions/:id',
  'me/push/preferences',
  'me/push/test',
]);
/**
 * Routes team members reach by role alone, without an access profile check: tickets (every
 * team member and rider talks to every other) and proof photos (kinds checked inside).
 */
const TEAM_BY_ROLE = /^(tickets|photos)(\/|$)/;

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
    const byRoleOnly: string[] = [];
    const accessRoutes: string[] = [];
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
        const access = reflector.getAllAndOverride<unknown>(ACCESS_KEY, [handler, metatype]);
        for (const p of paths) {
          const route = [base, String(p)].filter(Boolean).join('/').replace(/\/+/g, '/');
          checked++;
          if (isPublic) publicRoutes.push(route);
          else if (!roles?.length && !access && !ANY_SIGNED_IN.has(route)) open.push(route);
          // A team role named in @Roles must not skip the access profile, except on purpose.
          const team = roles?.some((r) => r === 'admin' || r === 'finance' || r === 'store_staff');
          if (team && !access && !TEAM_BY_ROLE.test(route)) byRoleOnly.push(route);
          if (access) accessRoutes.push(route);
        }
      }
    }
    expect(open).toEqual([]);
    expect(byRoleOnly).toEqual([]);
    expect(accessRoutes.length).toBeGreaterThan(200);
    expect(accessRoutes).toEqual(
      expect.arrayContaining(['admin/orders', 'finance/overview', 'stores/:storeId/summary']),
    );
    // The walk really sees the routes.
    expect(publicRoutes).toEqual(
      expect.arrayContaining(['auth/login', 'shopify/rates/:shopId', 'shopify/proxy/areas']),
    );
    expect(checked).toBeGreaterThan(100);
    // Public routes are only these: sign in, health, coverage, Shopify's and Slack's signed calls and
    // the customer's tracking page (its unguessable token is the key) and the e-invoice signing
    // program (its own key, checked in the controller).
    for (const route of publicRoutes)
      expect(route).toMatch(
        /^(auth\/(login|refresh|logout|signup)|health|coverage|shopify\/|track\/:token|slack\/(events|interactivity)$|eta-signer\/(documents|signatures)$)/,
      );
  });
});
