# Shiply Now: system architecture

Plain description of how the service is built, what runs where, and how the parts talk.
Business rules and every decision live in CLAUDE.md; the detailed specs are in docs/ACCESS.md,
docs/ZONES.md, docs/HR.md, docs/SALES.md, docs/SHOPIFY_DATA.md, docs/ETA.md and docs/DEPLOY.md.

## 1. What the service does

Shiply Now delivers Shopify merchants' orders within 60 minutes from small dark stores in
Greater Cairo. Merchants send stock in advance (through a sorting hub), the system keeps it
per store and shelf, Shopify sends the orders, store staff pick and pack them, riders deliver
and collect cash, and finance settles money with merchants. Around that core it runs HR,
accounting, customer data, the sales CRM and internal tickets for the company.

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
    finance     accounting: ledger, cash, payouts, bills, purchase orders, taxes, payroll run,
                invoices, ETA, bank matching, reports, closing
    packaging   packaging items, stock per store, recipes, buying, adjusting and counting
    email       merchant email outbox, billing email settings, Mailer boundary (SMTP)
    hr          employee files, documents, org chart, departments, grades, positions,
                checklists, attendance, shifts, roster, holidays, leave (types, requests,
                balances, calendar), violations (ladders, appeals, suggestions), attendance
                correction requests, the manager inbox
    sales       sales CRM: leads, pipeline, deals, companies, contacts, activities, My day,
                proposals (and their public page), targets, dashboard, commission, owner
                setup links
    site        the public website's contact form
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

    /                      public website home for signed out visitors (signed in: own area)
    /how-it-works, /solutions, /team, /contact   public website pages (open to everyone)
    /login, /signup        sign in and merchant sign up
    /home                  app tiles (Operations, Inventory, Merchants, Customers,
                           Accounting, HR, Sales, Settings, Store screens), only what the person
                           may open
    /admin/...             Operations, Inventory, Merchants, Customers, HR, Sales, Settings apps
    /admin/hr/...          HR app: the HR home (/overview, the app's first page), the employee
                           list and files (?tab=), one Organisation and one Attendance setup page
                           (HR phase 1)
    /admin/sales/...       Sales app: pipeline board and list, leads, My day, companies, deals,
                           proposals, dashboard, targets, commission
    /p/<token>             a brand's proposal (public, Accept or Decline)
    /setup/<token>         a new merchant owner chooses a password (public, one time)
    /finance/...           Accounting app
    /store/<storeId>/...   store staff screens (phone first, barcode scanning with the camera)
    /rider                 rider app (phone first)
    /merchant/...          merchant area (sidebar layout)
    /my-file               the person's own HR file, attendance and documents; /my-file/leave,
                           /violations, /corrections and /inbox (HR phase 3)
    /tickets, /help        tickets and role SOPs
    /t/<token>             public order tracking page

Apps, menus and the access each page needs are defined once in apps/web/src/lib/apps.ts.
Pages call the API from the server (lib/api-server) or the browser (lib/api-client).
Strings are never hard coded: messages/en.json and messages/ar.json hold every label.

### Public website

The company website is five public pages: `/` (SiteHome: hero with the example order, four
promises, results band, services, Why now, a How it works teaser and a closing call to action),
`/how-it-works` (HowItWorksPage), `/solutions` "For brands" (SolutionsPage), `/team` "Our team"
(TeamPage) and `/contact` (ContactPage: the lead form, Create an account, Merchant sign in and
the FAQ). On `/` a signed in person is sent to their own area as before (app/page.tsx, homeFor);
the other pages are open to everyone and the middleware's matcher never covers them. Every page
renders inside SiteShell: the top bar (links from site-nav.ts with the current page marked by
aria-current, language switch, Sign in, Start selling to /contact; SiteMenu, a client menu
button, on phones), the footer (Product, Company, Merchants) and a "Request a call" bar that is
sticky at the bottom of the screen on every page but Contact. Each page has its own title,
description, canonical address and Open Graph card in the visitor's language
(components/site/metadata.ts). app/robots.ts and app/sitemap.ts read WEB_ORIGIN per request
(signed in areas, /api and /t/ disallowed). The team cards come from the `site.team.people`
list in the messages (team.ts parses it; a photo is an optional file under public/site/team/,
else the card shows initials). The design is the one agreed with
the owner in docs/site/preview.html, rebuilt in components/site: the page components (server
rendered), SiteParts (shared icons and sections), site.css (light only, every rule under `.shiply-site` and every class `s-` so the app's
classes and themes never meet the site's), OrderTicket (the hero's example order, rendered at
its resting state of 47 minutes and delivered, replayed once unless the visitor prefers less
motion), LanguageSwitch (the app's `shiply_locale` cookie, then a server render in Arabic RTL
with IBM Plex Sans Arabic) and LeadForm. Every word, the results band figures included, comes
from the `site` messages in en.json and ar.json. The site never shows store locations, hubs,
balances or internal numbers. No page needs a session.

The contact form posts to POST /site/leads (public, zod `siteLeadSchema` in packages/shared,
5 per address in 15 minutes by the last X-Forwarded-For entry, like auth/signup). The form's
idempotency key makes a double tap one lead. A valid Egyptian mobile is stored as +20 and 10
digits; anything else is kept as typed with `phone_valid` false. The lead (site_leads, the raw
submission), its Sales CRM company, contact and deal at stage new, and one `site_lead` alert are
written in one transaction and audited (site_lead.create); the alert pushes to the sales
managers (or the rep the round robin chose). The follow up happens in the Sales app
(/admin/sales/leads, docs/SALES.md); /admin/leads redirects there.

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
                  budgets, assets, books_lock, company_profile, purchase_orders,
                  purchase_order_lines, purchase_order_receipts, email_outbox
    Packaging     packaging_items, packaging_levels, packaging_movements (append only),
                  packaging_recipes
    People        users, user_access, user_stores, refresh_tokens, employees, departments,
                  grades, job_positions, employee_photos, employee_documents and types,
                  salary_packages, salary_allowances, checklists, shifts, roster_days,
                  holidays, punches, attendance_days, leave_types, leave_requests,
                  leave_request_days, leave_adjustments, violation_types, violation_steps,
                  violations, violation_suggestions, attendance_corrections
    Customers     customers, customer_aliases, shop_customers, shop_orders, shop_products,
                  shop_data_syncs
    Sales         crm_companies, crm_contacts, crm_deals, crm_deal_stage_history (append
                  only), crm_activities, crm_lost_reasons, site_leads (website form intake),
                  crm_proposals and crm_proposal_tiers, crm_targets, crm_commissions and
                  crm_commission_lines, user_setup_tokens
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
riders hand cash to their store, staff count it (a cash order is not handed to a rider past the
store's cash limit unless a store manager gives a reason; cash held too long raises an alert) →
store staff may pay small expenses from the box as petty cash (with a receipt photo, large ones
wait for finance) → finance reads the daily cash position → finance deposits store boxes to the bank →
weekly payouts to merchants (prepared, approved by a second person, marked paid) → monthly tax
invoices and ETA e-invoices → bank statement matching → the month end checklist →
monthly closing. Payout and invoice
emails go to the merchant through the email outbox.

Packaging and purchasing:
finance raises a purchase order (PO-000001) to a supplier → approved at once below
finance.approval_threshold_piastres, otherwise by a second person → marked ordered → goods
received in parts into a store's packaging stock (Dr 1402 Packaging stock, Cr 2401 Goods
received not billed) → the supplier bill is made from the order for what was received (three
way: order, receipt, bill; within finance.po_bill_tolerance_bp) → paid like any bill → closed.
Packing an order uses its packaging recipe plus the chosen box and books Dr 5404 Packaging,
Cr 1402 with the store and order tags; low and short packaging raise alerts, packing is never
blocked.

People:
an account is created in Settings > Users with a job role → its HR file opens with the
onboarding checklist → documents are uploaded and verified → the person clocks in and out by
location against their shift → attendance days close automatically (suggesting violations for
lateness and absence) → leave is asked from My HR and approved by the manager then HR →
violations climb their ladder, may be appealed once and become final → the monthly payroll run
reads HR salary packages, takes unpaid leave days and final deductions once, and books it in
accounting.

## 9. Access control

Roles on the account: admin, finance, store_staff (team members), rider, merchant.
Team members have an access profile per app (none, view, use, manage) for store screens,
operations, inventory, merchants, customers, accounting, HR, sales and settings, plus the stores
they cover and the switches (customer data, salaries, own merchants only, own deals only). Job roles fill the profile in one click.
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
    attendance roster planning and daily close, then violations past their appeal window
    made final and suggested violations from the closed days
    automatic refill drafts
    daily storage fees
    rider cash overdue alerts (every ten minutes, one per rider and Cairo day)
    monthly finance (recurring expenses, prepayments, depreciation, accrual reversals)
    ETA e-invoice submission and status (every minute, only when configured)
    web push dispatcher (every 10 seconds, only when the VAPID keys are set)
    email outbox sender (every 30 seconds, only when SMTP is set)
    sales reminders (follow ups due, crm_followup_overdue and crm_deal_stale alerts, sent
      proposals past their last day expired)
    sales commission (once a Cairo day, from the second day of a month: last month's drafts,
      key commission:<rep>:<month>)

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
* Web push (optional): phone and browser notifications for every role, sent with the
  `web-push` package behind the PushSender boundary (apps/api/src/push: HttpPush with
  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT; FakePush in tests). Nothing is sent
  without the keys or while the push.enabled setting is 0, and the Notifications page
  (/notifications, Settings menu) then hides the switch. Devices are push_subscriptions
  (removed when the push service answers 404 or 410), switches are notification_preferences
  (a missing row is on). The dispatcher (dispatchPush in packages/db/src/push.ts) changes no
  business record: every 10 seconds it reads what happened in the last 15 minutes (new orders,
  alerts, shipments and transfers sent, deliveries, finance requests and payouts to approve,
  cash differences, ticket messages, late attendance days, merchant notifications, paid payouts,
  low stock) and calls notify(userIds, type, text) for the people who may open the page it
  links to: store staff of that store (store use), riders, accounting use, operations manage
  (paging alerts), merchants manage (sign ups), the merchant's account manager, HR use and the
  person (documents), the manager in force, HR use and HR manage and the person (leave requests,
  attendance fixes, violations and appeals, termination reviews), the ticket's other person,
  merchant users with the orders, money or stock
  right, sales managers (website leads, the leads queue) and the owner of a deal or follow up
  (deal given to them, follow up due or overdue, deal stuck in a stage), sales managers
  (a proposal's discount waiting for approval) and the proposal's maker or the deal's owner
  (approved, accepted, declined). Each event key is claimed in push_sent first (kept two days), so overlaps and other
  instances send it once; a failed send is counted on the device and reported through
  ErrorReporter, never failing the action. Words are in packages/shared/src/push.ts (en, ar,
  in the device's language). public/sw.js shows the notification and opens or focuses its page;
  the root layout registers it in production builds when VAPID_PUBLIC_KEY is set.
* Email (optional): merchant emails go through the Mailer boundary (apps/api/src/email:
  SmtpMailer with nodemailer and SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM;
  FakeMailer in tests). The business event writes the email to email_outbox in its own
  transaction with an idempotency key (payout_paid:<payout>, statement:<payout>,
  invoice:<invoice>), already rendered in the merchant's language from bilingual templates
  (packages/db/src/email-templates.ts, brand v2 colours, %BASE_URL% replaced with WEB_ORIGIN at
  send time); a repeat queues nothing. markPayoutPaid queues the payout notice and the statement
  of the payout period (from the previous paid payout's cutoff) with the statement CSV attached;
  prepareInvoices queues the invoice notice with a link to /merchant/invoices (there is no PDF
  route; the page prints). Recipients are merchants.billing_emails (else contact_email), in
  merchants.email_language, minus merchants.email_opt_outs (statement, payout_paid, invoice);
  the merchant edits them in Wallet, finance through the API. dispatchEmails claims due rows
  under SKIP LOCKED with a five minute lease, sends, and marks sent; a failure waits 30 seconds
  doubling up to an hour, and after 10 tries the row is failed with one email_failed alert.
  Without SMTP nothing is sent and the outbox (/finance/emails) and the wallet say so. Only the
  server's answer code is stored as the error, never addresses or bodies.
* Google geocoding (optional): only used when GOOGLE_MAPS_API_KEY is set.
* OpenStreetMap: map tiles in the admin map; area data imported through Overpass.

## 12. Configuration

One .env at the repo root, documented in .env.example. Key variables: DATABASE_URL,
JWT_ACCESS_SECRET, API_PORT, API_URL, WEB_ORIGIN, SEED_ON_START, SEED_ADMIN_*, DEMO_LOAD,
SHOPIFY_API_KEY / SHOPIFY_API_SECRET, SLACK_*, ETA_*, VAPID_*, SMTP_*, GOOGLE_MAPS_API_KEY, OVERPASS_URL,
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
