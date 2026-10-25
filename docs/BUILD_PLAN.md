# Shiply Now: Build Plan for Claude Code

Run these steps in order. Paste each prompt into Claude Code, review what it proposes, approve, and only move on when the step's check passes.

## Before you start

1. Install Claude Code (official guide: https://docs.claude.com/en/docs/claude-code/overview)
2. Install Docker Desktop, Node.js (LTS) and pnpm
3. Create an empty folder called shiplynow, put CLAUDE.md inside it, open a terminal there and start Claude Code
4. Create a Shopify Partner account and a development store (free) for testing
5. Get a Google Maps API key (only used for geocoding addresses in the pilot)

## Step 1: Foundation (1 to 2 days)

Prompt:
> Read CLAUDE.md. Set up the monorepo exactly as described: pnpm workspaces, apps/api (NestJS), apps/web (Next.js), packages/db (Prisma), packages/shared. Add docker compose with PostgreSQL 16 plus PostGIS and Redis. Add lint, typecheck, Vitest and a GitHub Actions CI workflow. Add auth with email and password, JWT, and roles admin, merchant, store_staff, rider. Show me the plan first.

Check: `pnpm test` passes, you can log in as an admin locally.

## Step 2: Data model (1 to 2 days)

Prompt:
> Create the Prisma schema for all main entities in CLAUDE.md, with PostGIS polygons for zones, append only stock_movements, order_events and audit_log, and a settings table. Seed: 3 dark stores (New Cairo, Maadi, Zamalek) with sample polygons, the 27 Egyptian governorates, one merchant called Eve Chantelle with 20 sample SKUs, one admin, two store staff, two riders. Write tests for the stock rules: reserve, release, pick, adjust, never below zero.

Check: migrations run, seed loads, stock tests pass.

## Step 3: Zones and coverage API (1 day)

Prompt:
> Build the coverage API: given an address or lat/lng, return the dark store that covers it using PostGIS point in polygon, respecting operating hours and live capacity from settings. Add an endpoint that lists covered areas by name for the storefront widget. Add an admin page to view zones on a map and edit hours and capacity.

Check: a New Cairo address returns the New Cairo store; an address in Alexandria returns no coverage.

## Step 4: Stock and dark store app (3 to 4 days)

Prompt:
> Build the dark store staff app at /store, mobile first, Arabic and English. Screens: receive an inbound manifest by scanning barcodes with the phone camera, put away to a bin, stock count with variance report, damaged and held items. Every action creates stock_movements in a transaction and writes the audit log.

Check: receive 10 units on your phone, see stock update in admin.

## Step 5: Shopify app (4 to 6 days)

Prompt:
> Build apps/shopify from the official Shopify app template using the GraphQL Admin API only. On install, register one fulfillment service per dark store. Implement callback_url/fulfillment_order_notification (accept or reject within 60 seconds, reserve stock, create the order), callback_url/fetch_stock, and push stock changes to Shopify within 60 seconds using a BullMQ job. Verify every Shopify webhook HMAC. Write integration tests with mocked Shopify responses.

Check: install on your development store, place a test order, it appears in the dark store queue and stock drops in Shopify.

## Step 6: Storefront zone widget (2 to 3 days)

Prompt:
> Build a Shopify theme app extension (app embed) that shows a banner "Delivery in 60 minutes, check your zone", lets the customer pick their area from the covered areas API or share location, saves the choice in the browser, and filters collection pages to variants in stock at that dark store. Product pages show "Arrives in 60 minutes" or "Standard delivery". Arabic and English.

Check: pick Maadi on the test store, only Maadi stock shows.

## Step 7: Orders, picking and SLA (3 to 4 days)

Prompt:
> Build the order queue in /store: orders sorted by SLA due time, pick screen with scan to confirm every item, pack screen with a photo, hand to rider by scanning the rider's code. Add SLA timers from settings and a BullMQ job that flags late steps on the admin board. If an item is missing at pick, mark the order moved_to_standard and notify admin.

Check: a test order goes from new to packed in under 5 minutes on your phone, a late order turns red on the board.

## Step 8: Rider app (2 to 3 days)

Prompt:
> Build the rider app at /rider, mobile first: list of assigned orders, open Google Maps navigation, call customer, mark delivered with a photo or customer OTP, record COD collected, mark failed with a reason. Update Shopify fulfillment with tracking and delivered status. Allow batching 2 orders per trip when both stay inside SLA.

Check: deliver a test order end to end and see it fulfilled in Shopify admin.

## Step 9: Admin dashboard and reports (2 to 3 days)

Prompt:
> Build /admin: live board per dark store (waiting, picking, out for delivery, late), stock per store with low stock alerts, orders list with filters, KPIs (pick time, order to door time, SLA hit rate, stock accuracy), settings editor for every configurable value, audit log viewer. Excel export for orders and stock.

Check: all KPIs show numbers from your test orders.

## Step 10: Hardening and deploy (3 to 5 days)

Prompt:
> Review the whole codebase for security and the rules in CLAUDE.md. Add rate limiting, input validation everywhere, error tracking, structured logs and daily database backups. Write Playwright tests for the full flow: Shopify order, pick, pack, deliver. Then prepare deployment to a cloud provider with a staging and production environment, and write a README for running and deploying.

Check: full flow test passes on staging.

## Tips

- Start every new session with: "Read CLAUDE.md and tell me where we left off."
- Commit after every step so you can roll back.
- If Claude Code proposes something outside CLAUDE.md, ask why before approving.
- Expect about 4 to 6 weeks for a careful pilot build working part time with Claude Code.
