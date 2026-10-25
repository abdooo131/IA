# Shiply Now

Standalone pilot of Shiply Now: 60 minute delivery for merchants on Shopify, run from small dark stores in Greater Cairo. Stock is placed in a dark store before the customer orders; at order time we only pick, pack and deliver.

This is a standalone system for the pilot. Later it will connect to the main Shiply courier platform (built by Qeema Tech) through APIs and webhooks, so keep every external boundary behind a clean service interface.

## Pilot scope (MVP)

1. Dark stores with delivery zones (polygons) and operating hours
2. Merchant SKU catalog matched to Shopify variants by SKU
3. Stock per dark store and bin: receive, put away, reserve, pick, adjust, count
4. Shopify app: registers one fulfillment service (Shopify Location) per dark store, receives fulfillment requests, reports stock and tracking
5. Storefront zone widget: customer picks area, catalog shows only items in stock at that store, 60 minute option at checkout
6. Order queue per dark store with SLA timers (accepted, picked, out for delivery, delivered)
7. Dark store staff web app (mobile first): receive, pick with barcode scan, pack with photo, hand to rider
8. Rider web app (mobile first): assigned orders, map link, mark delivered with photo or OTP, COD amount collected
9. Admin dashboard: dark stores, zones, merchants, stock, orders, SLA and basic KPIs

Out of scope for the pilot: ML forecasting, virtual stores on third party platforms, WooCommerce, accounting, payouts, Fawry integration, native mobile apps.

## Tech stack

- Language: TypeScript everywhere, strict mode
- Monorepo: pnpm workspaces
  - apps/api: Node.js REST API (NestJS), OpenAPI docs generated
  - apps/web: Next.js app with three areas: /admin, /store (dark store staff), /rider
  - apps/shopify: Shopify app built from the official Shopify app template, GraphQL Admin API only (REST Admin API is legacy, never use it)
  - packages/db: Prisma schema and migrations
  - packages/shared: shared types, zod schemas, constants
- Database: PostgreSQL 16 with PostGIS for zone polygons and point in polygon checks
- Queue and cache: Redis with BullMQ for background jobs (stock sync, SLA checks)
- Local dev: docker compose for Postgres, PostGIS and Redis
- Tests: Vitest for units, Supertest for API, Playwright for key web flows

## Core rules (never break these)

1. Money is stored as integers in piastres. Never floats. Convert to EGP only for display.
2. Stock changes only through stock_movements (append only). on_hand and reserved are derived or updated in the same DB transaction as the movement.
3. Every stock or order state change runs inside a DB transaction. No partial states.
4. Reserve stock at order creation. Release on cancel. Never let available go below zero.
5. Every action is audited: who, what, when, before and after.
6. No hardcoded business values (SLA minutes, capacity, fees, buffers). They live in a settings table editable from admin.
7. All inbound webhooks are verified (Shopify HMAC). All outbound webhooks are signed with HMAC SHA256 and retried with exponential backoff.
8. Background jobs are idempotent (idempotency keys) and safe to run twice.
9. Phone numbers are Egyptian: +20 prefix, 11 digits. All 27 governorates preloaded.
10. UI supports Arabic (RTL) and English (LTR). Strings go through i18n, never hardcoded in components.
11. Never commit secrets. Use .env with a .env.example kept up to date.

## Main entities

dark_stores, zones (PostGIS polygon per dark store), bins, merchants, skus (with shopify_variant_id), stock_levels, stock_movements, inbound_manifests, orders, order_items, order_events (append only), riders, deliveries, settings, audit_log, users with roles (admin, merchant, store_staff, rider).

## Order states

new → accepted → picking → packed → out_for_delivery → delivered
Side states: cancelled, failed, moved_to_standard (when stock is missing or the zone is closed).

## Shopify integration notes

- Use fulfillmentServiceCreate once per dark store with inventoryManagement and trackingSupport on
- Shopify calls callback_url/fulfillment_order_notification for fulfillment and cancellation requests
- Shopify calls callback_url/fetch_stock for stock levels; we also push stock changes through the inventory GraphQL mutations within 60 seconds
- Tracking and delivered status go back through fulfillment mutations
- Storefront widget is a theme app extension (app embed), no theme code edits for merchants

## Decisions log

- Step 1: the earlier Java Swing project lives in legacy/java; the monorepo is at the repo root.
- Step 1: one .env at the repo root for every app. The API and the web app both read it.
- Step 1: auth uses an httpOnly access JWT cookie (HS256) plus an opaque refresh token stored hashed and rotated on use. The web app proxies /api to the API so cookies stay first party. Next.js middleware runs on the Node.js runtime so the JWT secret is read at runtime and never bundled.
- Step 1: locale (en, ar) and theme (system, light, dark) are cookies, so the areas keep plain URLs /admin, /store, /rider.
- Step 1: Egyptian phone numbers accept mobiles only (010, 011, 012, 015) and are stored as +20 followed by 10 digits.
- Step 1: the postgis image's extra extensions (topology, tiger geocoder) are dropped at init; only postgis is used.
- Step 2: stock rules live in packages/db/src/stock (receive, move, reserve, release, pick, adjust) so the seed, the API and jobs share one implementation. Each call is one transaction (or joins the caller's), inserts the movement first, changes levels with guarded UPDATEs and writes audit_log.
- Step 2: stock_levels.on_hand counts only pickable bins. Receiving, damaged and held bins are tracked in bin_stock but are not sellable. Available = on_hand - reserved - stock.buffer_units.
- Step 2: units reserved by orders cannot be adjusted, moved or counted away; such calls fail with would_break_reservations.
- Step 2: the database enforces the hard rules too: CHECK constraints keep stock and money non negative, and triggers make stock_movements, order_events and audit_log reject UPDATE and DELETE.
- Step 2: settings are keyed by (key, scope) where scope is "global" or a dark store id. Definitions and defaults live in packages/shared/src/settings.ts. Defaults: SLA accept 2, pick 10, pack 5, hand over 5, ride 35, promise 60 minutes; stock buffer 0; low stock threshold 5; capacity 20 orders per hour.
- Step 3: GET /coverage (lat/lng or address) and GET /coverage/areas are public. Coverage picks the nearest store whose zone contains the point and that is open (Cairo time, hours may run past midnight) and under its hourly capacity; otherwise it answers outside_zones, at_capacity or store_closed with nextOpenAt.
- Step 3: capacity counts orders placed in the last 60 minutes, excluding cancelled and moved_to_standard, against store.capacity_orders_per_hour (store override, then global).
- Step 3: geocoding sits behind the Geocoder interface (Google today). Without GOOGLE_MAPS_API_KEY address lookups answer 503 geocoding_not_configured.
- Step 3: the admin map uses Leaflet with OpenStreetMap tiles and Geoman for editing; no map API key is needed. Zone borders are single polygons inside Egypt, validated by zod and PostGIS ST_IsValid.
- Step 4: merchants have a web area at /merchant (merchant users link to a merchant through users.merchant_id). Merchants create inbound manifests (shipments) there; staff receive against them. Manifest status: expected, receiving, received, cancelled.
- Step 4: receiving puts units in the store's receiving bin (not sellable); put away moves them to a shelf. Extra products not on the manifest get a line with expected 0. Closing a manifest notifies the merchant with expected against received.
- Step 4: stock counts are blind (staff see which products belong in the bin, not how many). Every difference waits for admin approval. If the bin changed between count and approval the count becomes stale and must be redone. Approved differences notify each affected merchant.
- Step 4: merchant notifications are stored in the notifications table and shown in the merchant panel; email or WhatsApp can be added later inside notifyMerchant without changing callers.
- Step 4: every staff action sends a client generated idempotency key, so double taps and retries apply once. Business rule refusals answer JSON { error: code } with 4xx.
- Step 4: scanning accepts typed codes, handheld scanners (keyboard input plus Enter) and the phone camera (@zxing/browser). Phone cameras need https.
- Step 2: the seed only creates missing rows and never overwrites admin edits. Zone polygons in the seed are rough test outlines, not real boundaries.

## Working style for Claude Code

- Before a big change, write a short plan and wait for approval
- Work in small steps; each step ends with passing tests and a commit
- Run lint, typecheck and tests before saying a step is done
- When unsure about a business rule, ask instead of guessing
- Keep this file updated when a rule or decision changes
