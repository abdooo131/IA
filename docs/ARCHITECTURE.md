# Shiply Now: system architecture

Plain description of how the service is built, what runs where, and how the parts talk.
Business rules and every decision live in CLAUDE.md; the detailed specs are in docs/ACCESS.md,
docs/ZONES.md, docs/HR.md, docs/SHOPIFY_DATA.md, docs/ETA.md and docs/DEPLOY.md.

## 1. What the service does

Shiply Now delivers Shopify merchants' orders within 60 minutes from small dark stores in
Greater Cairo. Merchants send stock in advance (through a sorting hub), the system keeps it
per store and shelf, Shopify sends the orders, store staff pick and pack them, riders deliver
and collect cash, and finance settles money with merchants. Around that core it runs HR,
accounting, customer data and internal tickets for the company.

## 2. Pieces at a glance

    Shopify stores ──(webhooks, fulfillment requests, checkout rates, app proxy)──┐
                                                                                   v
    Phones and browsers ──> Web app (Next.js) ──/api proxy──> API (NestJS) ──> PostgreSQL + PostGIS
                                                                 │                 (Neon)
                                                                 ├── background jobs (inside the API)
                                                                 ├── Shopify Admin GraphQL API
                                                                 ├── Slack (optional)
                                                                 ├── ETA e-invoice portal (optional)
                                                                 └── Google geocoding (optional)

One Docker image runs both the web app and the API. One database holds everything.

## 3. Repository layout (pnpm monorepo, TypeScript strict)

    apps/api          NestJS REST API, all business endpoints, background jobs
    apps/web          Next.js 15 app: every screen for every role, Arabic and English
    apps/shopify      Shopify app config (shopify.app.toml) and the storefront widget extension
    packages/db       Prisma schema, migrations, and ALL domain logic (orders, stock, money, HR...)
    packages/shared   Types, zod schemas, constants, settings definitions, pure helpers
    deploy            start.mjs: container entry point
    scripts           Shopify deploy helpers, SOP builder, load test, geo evaluation, ETA signer
    docs              Specs and how-to documents
    legacy/java       The old Java Swing project, not used

Rule of thumb: the API controllers are thin. They check access, validate input with zod and
call a function in packages/db. The seed, the jobs, the demo loader and the tests call the same
functions, so a business rule exists in one place only.

## 4. Runtime and hosting

* Render web service (Docker, region Frankfurt, free plan today). deploy/start.mjs:
  1. applies database migrations (prisma migrate deploy),
  2. loads starting data when SEED_ON_START is true (only missing rows),
  3. starts the API on 127.0.0.1:API_PORT and the web app on $PORT,
  4. optionally loads the demo month in the background when DEMO_LOAD is true.
* Neon Postgres 16 with PostGIS (region eu central). Free plan, 1 GB limit.
* The web app forwards every /api request to the API with a route handler, so cookies stay
  first party and the API is never exposed directly.
* Deploys are started from Render (the Render MCP tool or the dashboard) after a push to the
  ShiplyNow branch. GitHub Actions runs CI (lint, typecheck, tests) on every push.
* Backups: Neon's restore window, plus backup.yml (nightly encrypted pg_dump). Note: scheduled
  GitHub jobs only run from the default branch, so backup.yml must be on main to run.
* The web app is installable on phones (manifest, app icons, full screen). No native apps.

## 5. API (apps/api)

Modules under apps/api/src:

    auth        sign in, refresh, sign out, merchant sign up, guards (JWT, roles, access)
    users       /me endpoints (profile, access, attendance, my file, team)
    admin       admin endpoints: stores, zones, area map, stock, counts, transfers, returns,
                damage, merchants, products, users and access, settings, alerts, audit, history
    store       store staff screens: order queue, pick, pack, hand over, receive, put away,
                transfers, returns, counts, damage, cash handover
    rider       rider app: deliveries, delivered, failed attempts, calls, position pings
    merchant    merchant area: orders, shipments, returns, wallet, invoices, team, Shopify setup
    orders      order intake shared by merchant and admin
    coverage    public coverage and neighbourhood search, delivery decision service
    tracking    public tracking page data and ratings
    photos      proof photos (stored in Postgres)
    finance     accounting: ledger, cash, payouts, bills, taxes, payroll run, invoices, ETA,
                bank matching, reports, closing
    hr          employee files, documents, org chart, departments, grades, positions,
                checklists, attendance, shifts, roster, holidays
    tickets     internal tickets and Slack bridge
    shopify     OAuth install, webhooks, fulfillment service callbacks, carrier rates,
                app proxy (widget and area page), data exports, outbox
    jobs        background jobs
    health      health check
    common      error filter, error reporter, zod pipe, clock
    config      environment variables (validated with zod)

Request path: JwtAuthGuard (cookie or bearer token) → RolesGuard (riders, merchants) →
AccessGuard (team members: app and level per route, store scope, merchant rights) →
zod validation → controller → packages/db function in a transaction → AppErrorFilter turns
business refusals into { error: code } with a 4xx status.

OpenAPI docs are generated at /docs on the API.

## 6. Web app (apps/web)

Next.js 15 App Router, next-intl (en, ar with RTL), Tailwind with the Brand v2 tokens.

    /login, /signup        sign in and merchant sign up
    /home                  app tiles (Operations, Inventory, Merchants, Customers,
                           Accounting, HR, Settings, Store screens), only what the person may open
    /admin/...             Operations, Inventory, Merchants, Customers, HR, Settings apps
    /finance/...           Accounting app
    /store/<storeId>/...   store staff screens (phone first, barcode scanning with the camera)
    /rider                 rider app (phone first)
    /merchant/...          merchant area (sidebar layout)
    /my-file               the person's own HR file, attendance and documents
    /tickets, /help        tickets and role SOPs
    /t/<token>             public order tracking page

Apps, menus and the access each page needs are defined once in apps/web/src/lib/apps.ts.
Pages call the API from the server (lib/api-server) or the browser (lib/api-client).
Strings are never hard coded: messages/en.json and messages/ar.json hold every label.

## 7. Database (packages/db)

PostgreSQL 16 + PostGIS, Prisma 6, about 95 tables, migrations in packages/db/prisma/migrations.

Main groups of tables:

    Places        dark_stores (stores and hubs), bins, zones, store_areas, geo_areas,
                  geocode_cache, delivered_points, settings
    Catalog       merchants, skus, shopify_shops, shopify_apps, shopify_locations
    Stock         stock_levels, bin_stock, stock_movements (append only), inbound_manifests,
                  stock_counts, transfers, stock_targets, merchant_returns, damage_reports
    Orders        orders, order_items, order_events (append only), deliveries, riders, photos,
                  ratings, shopify_outbox
    Money         ledger_accounts, ledger_entries, ledger_lines (append only), cash_handovers,
                  payouts, finance_requests, bills, suppliers, tax_invoices, bank statements,
                  budgets, assets, books_lock, company_profile
    People        users, user_access, user_stores, refresh_tokens, employees, departments,
                  grades, job_positions, employee_photos, employee_documents and types,
                  salary_packages, salary_allowances, checklists, shifts, roster_days,
                  holidays, punches, attendance_days
    Customers     customers, customer_aliases, shop_customers, shop_orders, shop_products,
                  shop_data_syncs
    Other         audit_log (append only), alerts, notifications, tickets, ticket_messages

Hard rules enforced by the database as well as the code: money in integer piastres, no
negative stock or money (CHECK constraints), append only tables (triggers refuse UPDATE and
DELETE), ledger entries must balance (deferred trigger), closed books refuse new lines.

Every state change runs in one transaction and writes audit_log (who, what, when, before,
after). Staff actions carry idempotency keys so a double tap applies once.

## 8. Main flows

Stock in:
merchant creates a shipment (ASN) → it goes to the hub → hub staff receive by scan → put away
→ admin approved transfers (refill drafts are prepared daily) move stock to dark stores →
receive and put away there.

Order:
customer picks a neighbourhood in the storefront widget → Shopify asks our carrier service for
the 60 minute rate (only when the address is served, the store is open, under capacity and has
every item) → after payment Shopify sends a fulfillment request → the API decides the store with
resolveDelivery, creates the order and reserves stock → staff accept, pick by scan, pack with a
photo, hand to a rider by badge scan → rider delivers with the customer's code or a photo and
collects cash → ledger postings (merchant COD, our fees, rider bonus) in the same transaction →
tracking and DELIVERED go back to Shopify through the outbox.

Delivery decision (resolveDelivery, packages/db/src/geo):
map pin or known point → area or zone the customer chose → Google (only if configured) →
address text read by the area engine. Answers served, outside or unsure. Stores own areas
(neighbourhoods, districts) through store_areas.

Money:
riders hand cash to their store, staff count it → finance deposits store boxes to the bank →
weekly payouts to merchants (prepared, approved by a second person, marked paid) → monthly tax
invoices and ETA e-invoices → bank statement matching → monthly closing.

People:
an account is created in Settings > Users with a job role → its HR file opens with the
onboarding checklist → documents are uploaded and verified → the person clocks in and out by
location against their shift → attendance days close automatically → the monthly payroll run
reads HR salary packages and books it in accounting.

## 9. Access control

Roles on the account: admin, finance, store_staff (team members), rider, merchant.
Team members have an access profile per app (none, view, use, manage) for store screens,
operations, inventory, merchants, customers, accounting, HR and settings, plus the stores they
cover and two switches (customer data, salaries). Job roles fill the profile in one click.
Merchant users are owners or members with rights (orders, stock, money, settings).
The API checks every route; menus only hide what the API would refuse anyway. Details in
docs/ACCESS.md.

## 10. Background jobs

They run inside the API process every 20 to 30 seconds under a Postgres advisory lock, so only
one instance acts, and each has an idempotency key so running twice changes nothing:

    SLA late flags and failed delivery holds
    Shopify sync per shop: outbox calls, fulfillment and cancellation requests, stock pushes
    Shopify data exports (orders, customers, products, stock)
    customer linking (our orders to customer profiles)
    ticket reminders
    document expiry alerts
    attendance roster planning and daily close
    automatic refill drafts
    daily storage fees
    monthly finance (recurring expenses, prepayments, depreciation, accrual reversals)
    ETA e-invoice submission and status (every minute, only when configured)

## 11. Integrations

* Shopify: one custom app per merchant. GraphQL Admin API 2026-10 only. OAuth or client
  credentials install, encrypted tokens, HMAC checked on every callback, fulfillment service
  (one Shopify location per dark store), carrier service for the 60 minute rate, app proxy for
  the widget and area page, webhooks for products, orders, customers and privacy requests.
  Calls back to Shopify go through shopify_outbox with retries.
* Storefront widget: theme app extension in apps/shopify/extensions/zone-widget, plain
  JavaScript, writes the chosen area or pin to the cart.
* Slack (optional): tickets as direct messages, replies come back signed.
* ETA (optional): Egyptian e-invoice portal. Documents are signed on the finance PC by
  scripts/eta-signer with the USB token, then submitted by the API.
* Google geocoding (optional): only used when GOOGLE_MAPS_API_KEY is set.
* OpenStreetMap: map tiles in the admin map; area data imported through Overpass.

## 12. Configuration

One .env at the repo root, documented in .env.example. Key variables: DATABASE_URL,
JWT_ACCESS_SECRET, API_PORT, API_URL, WEB_ORIGIN, SEED_ON_START, SEED_ADMIN_*, DEMO_LOAD,
SHOPIFY_API_KEY / SHOPIFY_API_SECRET, SLACK_*, ETA_*, GOOGLE_MAPS_API_KEY, OVERPASS_URL,
JOBS_ENABLED. Business values (SLA minutes, fees, capacity, payroll rates, HR rules) are not in
env: they live in the settings table and are edited from each app's Configuration page.

## 13. Testing

    packages/shared   Vitest unit tests (pure rules: phones, hours, payroll tax, access...)
    packages/db       Vitest against a real Postgres + PostGIS test database
    apps/api          Vitest + Supertest against the test database, incl. a test that fails
                      if any route has no access rule
    apps/web          Vitest (helpers, translations parity, colour contrast of the brand tokens)

Run: pnpm -r typecheck, pnpm -r lint, prettier --check ., then each package's vitest.
Screens are checked with Playwright screenshots during development.

## 14. Known limits today

* Free Render server: slow, sleeps when idle, 15 minute start limit; Shopify rate calls need a
  server that never sleeps (paid plan before launch).
* Free Neon plan: 1 GB; proof photos and documents are stored in the database.
* Background jobs and the sign in rate limit live in one API process (fine for one instance).
* The logo files are traced from the brand guide images until vector files arrive.
* Each merchant's Shopify app must be redeployed to receive widget changes.
