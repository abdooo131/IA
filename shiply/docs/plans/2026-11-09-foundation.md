# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Shiply workspace with login, access per app, settings, audit, events that are never lost, Arabic and English, and the shell every app uses (top bar, Home, app top menu, list and record pages).

**Architecture:** pnpm monorepo in `shiply/`. One NestJS API and one Next.js web app on one PostgreSQL database, one schema per module; this plan builds only the `platform` module. Modules talk by public service interfaces and by outbox events.

**Tech Stack:** Node 22, pnpm 10, TypeScript strict, NestJS 11, Next.js 15 (App Router), Prisma 6 with `multiSchema`, PostgreSQL 16 with PostGIS, Redis 7 with BullMQ, next-intl, Vitest, Supertest, Playwright.

**Spec:** `shiply/docs/TECH.md` (sections 1 to 8, 11 step 1) and `shiply/docs/UI.md` (Steps 1, 1b, 1c, 2).

## Global Constraints

- Money is integer piastres; never floats. Display converts to EGP with 2 decimals.
- Egyptian mobiles: stored as `+20` followed by 10 digits (`01XXXXXXXXX` input, 11 digits); Arabic Indic digits accepted on input.
- No user facing text in components: every string is an i18n key with `ar` and `en` values.
- Arabic pages render `dir="rtl"`, English `dir="ltr"`.
- No business values in code: they live in `platform.settings`.
- Every write is audited (who, what, when, before, after) and accepts an `Idempotency-Key` header.
- A module writes only its own schema; importing another module's internals fails lint.
- Never commit secrets; `.env.example` lists every variable.
- The 12 tiles, in order: shiply_now, shiply, merchants, care, location, fleet, purchasing, accounting, hr, sales, reports, settings. Access levels: none, view, use, manage.

## Review Focus

1. Mobile typed with Arabic Indic digits (`٠١٠١٢٣٤٥٦٧٨`) or spaces at login: signs in the same as `01012345678`.
2. The same POST sent twice with one `Idempotency-Key`: done once, second call returns the first result.
3. A user opening an app URL they have no access to: a clear "no access" page, never a blank page or a crash.
4. Arabic: top menu, table and record page mirror correctly (More ▾ on the left, timeline on the left).
5. Session expired in the middle of work: redirected to login, then back to the same page after signing in.

---

## File Structure

```
shiply/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.mjs  docker-compose.yml  .env.example
  packages/shared/src/   money.ts  phone.ts  status.ts  access.ts (tiles, levels)  index.ts
  packages/db/prisma/schema.prisma   packages/db/src/ client.ts  seed.ts
  apps/api/src/
    main.ts  app.module.ts
    platform/ index.ts (public interface)
      auth/  access/  settings/  audit/  idempotency/  events/  users/  home/
  apps/web/src/
    i18n/ ar.json en.json request.ts
    app/[locale]/ login/  (shell)/layout.tsx  (shell)/page.tsx (Home)  (shell)/settings/...
    shell/ TopBar.tsx  AppMenu.tsx  Tiles.tsx  ListPage.tsx  RecordPage.tsx  Confirm.tsx  Toast.tsx
    theme/ tokens.css (from design/shiply-ui-handoff in the old branch)
```

---

### Task 1: Workspace and shared rules

**Files:**
- Create: `shiply/package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `packages/shared/src/{money,phone,status,access,index}.ts`
- Test: `packages/shared/src/*.test.ts`

**Interfaces:**
- Produces: `toPiastres(egp: string): number`, `formatEgp(p: number, locale: 'ar'|'en'): string`; `normalizeEgyptMobile(input: string): string | null` (returns `+201XXXXXXXXX`); `defineMachine<S extends string>(allowed: Record<S, readonly S[]>): { can(from: S, to: S): boolean; assert(from: S, to: S): void }`; `TILES: readonly AppId[]`, `type AppId`, `type Level = 'none'|'view'|'use'|'manage'`, `atLeast(have: Level, need: Level): boolean`.

- [ ] **Step 1: Write failing tests**

```ts
expect(toPiastres('12.5')).toBe(1250); expect(() => toPiastres('1.234')).toThrow();
expect(normalizeEgyptMobile('٠١٠١٢٣٤٥٦٧٨')).toBe('+201012345678');
expect(normalizeEgyptMobile('0101 234 5678')).toBe('+201012345678');
expect(normalizeEgyptMobile('+20 1012345678')).toBe('+201012345678');
expect(normalizeEgyptMobile('0201234567')).toBeNull();      // landline
const m = defineMachine({ a: ['b'], b: [] }); expect(m.can('a','b')).toBe(true); expect(() => m.assert('b','a')).toThrow();
expect(TILES).toHaveLength(12); expect(atLeast('use','view')).toBe(true); expect(atLeast('view','manage')).toBe(false);
```

- [ ] **Step 2:** Run `pnpm --filter @shiply/shared test`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the five files. ESLint: `no-restricted-imports` forbids `**/modules/*/!(index)` paths across modules; `@typescript-eslint/no-floating-promises` on.
- [ ] **Step 4:** Run tests and `pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shiply): workspace and shared rules`.

### Task 2: Database and platform schema

**Files:**
- Create: `docker-compose.yml` (postgis/postgis:16, redis:7), `.env.example`, `packages/db/prisma/schema.prisma`, `packages/db/src/{client,seed}.ts`
- Test: `packages/db/test/seed.test.ts`

**Interfaces:**
- Produces Prisma models in schema `platform`: `User(id cuid, name, nameAr, email?, mobile? unique, passwordHash, kind: staff|agent_person|agent_manager|merchant_user, active, roleId)`, `JobRole(id, key unique, nameEn, nameAr)`, `RoleAccess(roleId, app, level)`, `UserSite(userId, siteId)` (siteId is a plain string until Location exists), `Setting(key unique, value Json, updatedBy, updatedAt)`, `AuditLog(id, at, userId?, action, entity, entityId, before Json?, after Json?)`, `IdempotencyRecord(key, userId, route, status, body Json, at)`, `OutboxEvent(id, type, payload Json, at, key unique)`, `EventDelivery(eventId, handler, status: pending|done|dead, attempts, lastError?, nextAt)`, `Company(id, key unique: shiply_now|shiply, nameEn, nameAr, taxNumber?)`, `CostCentre(id, companyId, code unique, nameEn, nameAr)`.
- Seed (idempotent): companies Shiply Now and Shiply; job roles `owner` (manage on all 12 apps) and `viewer` (view on all); admin user from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

- [ ] **Step 1:** Test: running `seed()` twice leaves 2 companies, 2 roles, 1 admin, and 12 `RoleAccess` rows for owner.
- [ ] **Step 2:** Run `pnpm db:up && pnpm db:test`. Expected: FAIL.
- [ ] **Step 3:** Write schema, first migration, seed (upserts only).
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shiply): database and platform schema`.

### Task 3: API platform: login, access, audit, idempotency, settings

**Files:**
- Create: `apps/api/src/{main,app.module}.ts`, `apps/api/src/platform/{index.ts, auth/*, access/*, audit/*, idempotency/*, settings/*, users/*, home/*}`
- Test: `apps/api/test/platform.e2e.test.ts`

**Interfaces:**
- Produces routes: `POST /auth/login {login, password}` (login is email or mobile, normalized with `normalizeEgyptMobile`) sets httpOnly cookies `sid` (15 min) and `rid` (30 days); `POST /auth/refresh`; `POST /auth/logout`; `GET /me` → `{id, name, nameAr, kind, access: Record<AppId, Level>}`; `GET /me/home` → `{attention: AttentionItem[], numbers: Number[], tiles: {app: AppId, count: number}[]}` (attention and numbers empty arrays until modules add providers); `GET/PUT /settings/:key` (settings manage); `GET /users`, `POST /users`, `PATCH /users/:id` (settings manage); `GET /audit?entity&entityId&page` (settings view).
- Produces decorators and services exported from `platform/index.ts`: `@NeedAccess(app: AppId, level: Level)`, `AuditService.record(tx, {action, entity, entityId, before, after})`, `SettingsService.get<T>(key: string): Promise<T>`, `HomeRegistry.addAttention(provider)`, `HomeRegistry.addNumbers(app, provider)`.
- Every non GET route runs through the idempotency interceptor: same `Idempotency-Key` and user returns the stored status and body.

- [ ] **Step 1:** Write e2e tests:
  - login with `'٠١٠١٢٣٤٥٦٧٨'` for a user saved as `+201012345678` → 200 and `sid` cookie;
  - wrong password 5 times → 6th answers 429 for 15 minutes (`auth.lockout_minutes` setting);
  - `GET /me` without cookie → 401 `{error:'signed_out'}`;
  - viewer `POST /users` → 403 `{error:'no_access', app:'settings', need:'manage'}`;
  - owner `POST /users` twice with one `Idempotency-Key` → one user, both answers equal;
  - `POST /users` writes an `AuditLog` row with `after` and no password hash in it;
  - `GET /me/home` for viewer → 12 tiles, each `count: 0`.
- [ ] **Step 2:** Run `pnpm --filter @shiply/api test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Passwords with argon2id; JWT signed with `JWT_SECRET`; OpenAPI at `/docs`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shiply): api platform`.

### Task 4: Events that are never lost

**Files:**
- Create: `apps/api/src/platform/events/{outbox.ts, worker.ts, registry.ts, dead-letters.controller.ts}`
- Test: `apps/api/test/events.test.ts`

**Interfaces:**
- Produces: `publish(tx: Prisma.TransactionClient, type: string, payload: object, key: string): Promise<void>` (writes `OutboxEvent` in the caller's transaction; same key twice is ignored); `onEvent(type: string, handlerName: string, fn: (payload, tx) => Promise<void>)`; worker delivers each event once per handler, retries with backoff 1, 5, 30, 120 minutes (`events.retry_minutes` setting), then marks `dead`; `GET /events/dead` and `POST /events/dead/:id/retry` (settings manage). A dead delivery adds an attention item for settings managers.

- [ ] **Step 1:** Tests: event published inside a rolled back transaction is never delivered; a handler that throws 4 times is retried then `dead` with `lastError`; retry from the dead list delivers it; a handler run twice for the same event (worker crash simulated) changes data once.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with BullMQ; the delivery row is claimed with `SELECT ... FOR UPDATE SKIP LOCKED`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shiply): outbox events with dead letters`.

### Task 5: Web shell: login, top bar, Home, app menu, list and record pages

**Files:**
- Create: everything under `apps/web/src` in the File Structure; `apps/web/e2e/shell.spec.ts`
- Copy: brand tokens, fonts and icons from `design/shiply-ui-handoff` on branch `claude/vibrant-goldberg-0yxoxq` into `apps/web/src/theme/`

**Interfaces:**
- Consumes: Task 3 routes. The web app proxies `/api/*` to the API so cookies stay on the web origin.
- Produces components: `<AppShell app={AppId} menu={MenuItem[]}>` (top menu beside the logo, overflow into `More ▾` after 7 items, dropdown groups, ☰ on phones); `<ListPage title action filters columns rows bulkActions page pageSize=50 onExport>` (cards on phones); `<RecordPage number status actions tabs timeline>` (timeline under details on phones); `confirm({title, body, danger}) => Promise<boolean>`; `toast.success(key) / toast.error(key)`.
- Home (UI.md Step 1b): top bar (logo, search box, عربي/English, bell, ⊞ Apps, name); "Needs your attention" from `attention` (empty text key `home.nothingWaiting`: "Nothing waiting for you" / "لا يوجد شيء في انتظارك"); "Today in numbers"; tiles from `tiles`, showing only apps with level above none, count badge when above 0.
- No access to an app route → `<NoAccess app>` page. Signed out → `/login?next=<path>`, then back to `next`.

- [ ] **Step 1:** Playwright tests: owner logs in, sees 12 tiles; viewer opens `/en/settings/users/new` → "no access" page; switching to Arabic sets `dir="rtl"` on `<html>` and the More ▾ menu sits on the left; cookie cleared then a click → login page, after login back on the same page; a ListPage demo route with 120 rows shows 3 pages of 50.
- [ ] **Step 2:** Run `pnpm --filter @shiply/web e2e`. Expected: FAIL.
- [ ] **Step 3:** Implement. Every string through next-intl; no literal text in components (lint rule `i18next/no-literal-string` on `src/shell` and `src/app`).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shiply): web shell`.

### Task 6: Settings app (first real app on the shell)

**Files:**
- Create: `apps/web/src/app/[locale]/(shell)/settings/{users,users/[id],access,audit,dead-letters}/page.tsx`, `apps/web/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: Task 3 and 4 routes, Task 5 components.
- Menu (UI.md Step 3l, the parts this step needs): `Users & access  Audit log  Dead letters`. The rest (Companies, Integrations, Notifications, General) comes with the modules that need them.

- [ ] **Step 1:** Playwright: owner creates a user with mobile `٠١١٢٣٤٥٦٧٨٩` and role viewer → the user list shows `+201123456789`; that user logs in and sees tiles but no "New user" button; the audit log shows "User created" in English and its Arabic text in Arabic; a dead event shows in Dead letters and Retry delivers it.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with ListPage and RecordPage only (no one off layouts).
- [ ] **Step 4:** Run `pnpm test && pnpm e2e && pnpm lint`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(shiply): settings app` and push.

---

**Done when:** `pnpm db:up && pnpm db:deploy && pnpm db:seed && pnpm dev` gives a working login, Home with tiles per access, Arabic and English, and the Settings app; all tests pass.
