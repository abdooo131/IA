# Shiply technical design

How the new system is built. It follows the locked UI decisions in UI.md and MERCHANT_PORTAL.md
and adds no new business decisions. Nothing is live, so nothing is migrated: the database starts
from migrations and seed data.

## 1. The one rule

**Every piece of data and every decision has exactly one owner module.** Other modules ask the
owner or react to what it announces; they never write its tables. This is what the old system
lacked: two copies of cash, contracts, payroll and the map, and nobody knew which was right.

## 2. Tools

Same as the old system, so its working parts can be reused:

1. TypeScript everywhere, strict.
2. pnpm workspaces in `shiply/`:
   - `apps/api`: NestJS REST API, OpenAPI docs.
   - `apps/web`: Next.js: the office apps, the merchant portal, the phone screens (installable
     web app) and the public customer page.
   - `packages/db`: Prisma schema, migrations, seed.
   - `packages/shared`: types, validation (zod), statuses and their allowed changes, money and
     date helpers, i18n keys.
   - `packages/address`: the address engine from `address-lab`, moved in as is with its tests.
3. PostgreSQL 16 with PostGIS (area shapes, point in area). Redis with BullMQ for background
   jobs.
4. Tests: Vitest (rules), Supertest (API), Playwright (the main journeys).
5. Local: docker compose for PostgreSQL and Redis.

## 3. Modules and what each owns

One app, one database, one PostgreSQL schema per module. A module's tables are written only by
its own code.

| Module | Owns | UI app |
| --- | --- | --- |
| platform | users, logins, job roles and access, settings, audit log, notifications, files, companies, cost centres | Settings, Home |
| location | places and spellings, taught names, the map (areas, delivery zones), sites (sorting facilities, last mile hubs, dark stores), the address decision, the needs location queue, phone memory | Location |
| merchants | merchants, their users, contracts and prices for both services, Shopify shops, products catalog | Merchants, merchant portal |
| money | ledger, cash holders and handovers, wallets, payouts, bills, expenses, invoices and tax, banks, budgets | Accounting |
| parcels | parcels, pickups, scans, bags and seals, night cars, runs, attempts, courier operations | Shiply |
| now | 60 minute orders, stock per store and bin, store floor, rider operations | Shiply Now |
| care | tickets, cases, conversations, audits | CS and QC |
| agents | agents, their people, vehicles, requests, truck routes, compliance, settlements | Agents & Fleet |
| purchasing | material items, stock per material warehouse, consumption, suggestions, POs, receiving, transfers, suppliers | Purchasing |
| people | employees, attendance, leave, violations, payroll | HR |
| sales | leads, companies, pipeline, proposals, onboarding, account health, targets | Sales |
| reports | read models built from the other modules' events; owns no business data | Reports |

Ownership of things that were duplicated before:

1. **Cash**: only money. Couriers, riders, store boxes, hub safes and agents are all cash holders
   of one kind. Parcels and now announce "cash collected"; money books it.
2. **Contracts and prices**: only merchants. Parcels, now and money ask merchants for a price.
3. **The map and sites**: only location. Parcels and now ask location where an address belongs
   and which hub, zone or store serves it.
4. **Payroll**: only people. Money receives one booked total per run.
5. **Agent people**: only agents. Parcels and now see them as couriers and riders through agents.

## 4. How modules talk

1. **Asking**: a module calls another module's service through its public interface (one
   `index.ts` per module). Calling into another module's internals or tables fails the lint check.
2. **Announcing**: a module writes an event (for example `parcel.delivered`,
   `cash.handed_over`, `deal.won`) to an outbox table in the same transaction as its own change.
   A worker delivers each event to the modules that react to it.
3. **Nothing is lost silently**: every event is handled once (idempotency key) and retried with
   backoff. An event that keeps failing goes to a dead letter list shown in Settings, with the
   reason, and alerts the admin.

## 5. Rules carried from the old system

1. Money is whole piastres, never floats. The ledger is double entry and append only; corrections
   are new entries.
2. Every state change runs in one database transaction with its event and its timeline entry.
3. Statuses change only along the allowed list in `packages/shared`.
4. Every action is audited: who, what, when, before and after.
5. No business values in code (SLA minutes, fees, bag size, safety days, penalty rules): they live
   in settings.
6. The same request sent twice is done once (idempotency keys on every write and every scan).
7. Inbound webhooks are verified (Shopify HMAC); outbound webhooks are signed and retried.
8. Egyptian phones (+20, 11 digits); the 27 governorates seeded.
9. Never commit secrets; `.env.example` kept current.

## 6. Logins and access

1. One login per person: email or Egyptian mobile, password, optional 2FA. Sessions in httpOnly
   cookies on the web origin.
2. Access per app at none, view, use or manage, given by job role; scoped to sites where it
   matters (a hub worker sees only their hub, a rep only their deals).
3. Kinds of user: staff, agent person, agent manager, merchant user. Customers never log in; their
   links carry a signed token for one parcel or order.

## 7. Arabic and English

Every string is an i18n key in Arabic and English; no text in components. The page direction
follows the language (RTL for Arabic). Names that people type are stored in both languages where
the UI shows both (places, merchants, employees).

## 8. Phone screens and scanning

1. The phone screens are the same Next.js app, installable on the phone.
2. Scans are queued on the device (IndexedDB) with a scan id made on the device, and sent when
   there is signal. The API accepts each scan id once, so a repeated send is harmless.
3. Each scan answers with what the screen shows (colour, big message, sound) so the device needs
   no business logic.

## 9. Outside services, each behind an adapter

Shopify (GraphQL Admin API only), WhatsApp and SMS, e-invoicing to the tax authority, email.
Each has a fake for tests and local work, so nothing outside is needed to run the system.

## 10. Reused from the old system, after review

1. The address engine (address-lab).
2. Shopify webhook checks and app setup.
3. The e-invoicing signer.
4. The brand tokens, fonts and icons from the UI handoff.
5. Seed data: governorates.
6. The parcel status list and allowed changes, reviewed against the agreed flow.
7. The old test scenarios, as a checklist that the new system passes the same journeys.

## 11. Build order

Each step: plan → build with tests → owner checks it in the browser → next.

1. **Foundation**: workspace, database, platform (login, access, settings, audit, events, i18n,
   the shell: top bar, Home, app tiles, list and record page patterns).
2. **Location**: address engine, places, map and sites, needs location queue, phone memory.
3. **Merchants**: merchants, contracts and prices, products, the merchant portal shell.
4. **Money phase 1**: cash holders and handovers, wallets, payouts, bills, expenses, ledger with
   profit and loss.
5. **Parcels**: pickups, the full network flow with scans and bags, runs, couriers, merchant
   portal orders.
6. **Agents & Fleet**.
7. **Now**: stores, stock, store floor, riders.
8. **Care**: inbox, tickets, cases, audits.
9. **Purchasing**, **People**, **Sales**, **Reports**.
10. **Money phase 2**: invoices and tax, banks, budgets, year end.
