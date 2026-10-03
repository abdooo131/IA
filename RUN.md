# Shiply: how to run

## Phase 1: Foundation + merchant orders

### What is in this phase

* pnpm monorepo: `apps/api` (NestJS), `apps/merchant` (merchant portal), `apps/ops` (internal dashboard), `packages/shared` (types, statuses, validation), `packages/ui` (React pieces shared by the two web apps)
* Auth with JWT access tokens and rotating refresh tokens, RBAC on every endpoint, separate logins per app
* Postgres row level security: a merchant only ever sees its own rows, enforced in the database
* Append only `audit_log` and `order_events` (triggers plus revoked privileges), no DELETE granted anywhere
* `system_config` with every business value from the spec (66 keys), editable in ops with an audit trail
* Pricing engine (zone, size, type, tier, VAT, COD fee, open package fee, failed delivery fee), price frozen on the order by a database trigger
* Order status state machine with an explicit transitions table, every transition writes `order_events` and `audit_log`
* Orders: manual form, CSV import with a row level error report, tracking number with check digit, Code128 barcode, AWB label PDF (single and bulk, Arabic supported), printed / not printed filter
* Arabic (RTL) and English (LTR), language stored per user
* Seed: Eve Chantelle, Nabta, Essentials, Hanser; Cairo Sorting Facility; Maadi, Nasr City, Mohandessin and 6th of October last mile hubs

### Option A: Docker

```bash
docker compose up -d --build
docker compose exec api pnpm db:seed
```

Then open http://localhost:3000 (merchant) and http://localhost:3001 (ops). API: http://localhost:4000/api/health

Note: Docker was not available in the environment where this phase was built, so the compose file and Dockerfiles were written but not executed there. Option B below is what was run and tested.

### Option B: local services

Requirements: Node 22, pnpm 10, PostgreSQL 16 with PostGIS 3, Redis 7.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # adjust the two database URLs if needed
createdb -h localhost -U postgres shiply    # PostGIS is enabled by the first migration
pnpm --filter @shiply/shared build
pnpm db:migrate                             # creates tables, RLS policies, triggers and the shiply_app role
pnpm db:seed                                # idempotent, safe to run again

pnpm dev:api        # http://localhost:4000/api
pnpm dev:merchant   # http://localhost:3000
pnpm dev:ops        # http://localhost:3001
```

`DATABASE_URL` must use the `shiply_app` role (created by the migration) so row level security applies. `MIGRATE_DATABASE_URL` uses the database owner and is only used by migrations.

### Demo accounts

Every account uses the password `Shiply@2026`.

| App | Email | Role |
|---|---|---|
| Merchant | owner@evechantelle.com | Eve Chantelle owner (Bronze tier, VAT on) |
| Merchant | team@evechantelle.com | Eve Chantelle team member (Arabic UI) |
| Merchant | owner@nabta.com, owner@essentials.com, owner@hanser.com | Other merchants (Silver, Gold, Bronze) |
| Ops | admin@shiply.eg | Super Admin |
| Ops | ops@shiply.eg | Operations Manager |
| Ops | dispatch@shiply.eg, finance@shiply.eg, qc@shiply.eg, drivers@shiply.eg, hub.maadi@shiply.eg | Other staff roles |

Driver accounts (pickup.driver@shiply.eg, delivery.driver@shiply.eg) exist for later phases and are refused by both web apps.

### What to click (Phase 1 acceptance)

1. Open http://localhost:3000 and sign in as `owner@evechantelle.com`.
2. The dashboard shows today's counts by status, expected vs collected COD, next cashout date and the orange "Awaiting your action" alert (one seeded order is waiting).
3. Click **Import CSV**, choose `samples/eve-chantelle-10-orders.csv`, click **Upload CSV**. The result shows 10 rows imported with their tracking numbers and frozen total fees. Try **Download CSV template** for the column format. To see the error report, edit a phone to `0123` or a governorate to `Atlantis` and upload again: valid rows import, bad rows are listed with row, field and message, and **Download error report** gives a CSV.
4. Click **Print selected labels** on the import result (or select rows in **Orders** and use bulk print). A 4x6 inch AWB PDF opens with barcode, hub code, COD and Arabic text rendered correctly.
5. Open any order. The **Fees** card shows shipping, COD fee, open package fee, VAT, total and the failed delivery charge, all frozen at creation. The **Timeline** shows Order created and Label printed events.
6. In **Orders**, filter by Printed / Not printed, status group, governorate, date or search by phone.
7. Create an order in **New order** with area `Maadi`: it lands on the MAADI hub. An Aswan address is flagged "Needs manual hub assignment".
8. On an order in New status, use **Move to → Pending Pickup**. The transition appears in the timeline.
9. Click **العربية** in the header: the whole portal switches to Arabic RTL and the choice is saved for this user.
10. Open http://localhost:3001 as `ops@shiply.eg`: all merchants' orders, any allowed transition on an order (for example walk an order to Delivered), **System config** (edit a value, for example `pricing.open_package_fee`, new orders use it while existing orders keep their frozen price), **Pricing** tables and **Audit log** showing who changed what, with before and after.

## Accounting module (built ahead of Phase 5 on request)

### What it does
* **Ledger:** double entry, with a seeded chart of accounts (bank, cash with drivers, Fawry receivable, merchant wallets, COD awaiting settlement, VAT payable, driver and franchise payable, revenues, expenses). The database rejects any journal whose debits and credits differ, and ledger rows can never be edited or deleted.
* **Automatic postings:**
  * When an order is Delivered, its COD is recorded as cash with the driver.
  * The **midnight cash cycle** (BullMQ, 00:05 Cairo time, configurable) moves delivered COD into the merchant wallet, takes Shiply's frozen fees (shipping, COD fee, open package fee, VAT), and charges failed deliveries 60% plus VAT. Each order settles exactly once, and only one run can happen at a time.
* **Merchant wallet** (merchant portal, Wallet):
  * Balance, amount available to cash out, money arriving tonight, and a statement with a running balance
  * Cashout requests by bank (15 EGP), Fawry account (1%) or Fawry Yellow Card (1%), plus bank details with the 15 day lock
  * Automatic cashouts on the merchant's cashout day (daily, every 2 days, weekly)
* **Finance in ops:**
  * Overview of the cash position, with "Run cash cycle now"
  * Cashout approvals (payout through a mock adapter until real credentials exist)
  * Merchant wallets with compensation and deduction adjustments
  * Cash deposits (driver to Fawry, driver to bank, Fawry to bank; a reference can never be reused)
  * The journal, with reversals of adjustments and deposits
  * Reports: trial balance, profit and loss, balance sheet, cash flow, daily COD and merchant profitability, each with background Excel and PDF export
* **Not yet:** driver earnings and franchise statements need the driver apps and the Phase 5 points engine. Their accounts already exist.

### What to click
1. **Merchant portal**, as `owner@evechantelle.com`: open **Wallet**. The seed has already settled one delivered order (+450 COD, minus 99.18 fees) and one failed order (minus the failed delivery charge), and opened a pending bank cashout. Request a Fawry cashout and watch the fee preview.
2. **Operations**, as `finance@shiply.eg`:
   * **Finance → Overview** shows the cash position and the cash cycle runs.
   * **Cashouts:** approve the pending cashout. It gets a mock payout reference, and the merchant's balance drops.
   * **Orders:** move any order to Delivered. Then go back to **Overview** and press **Run cash cycle now**; the merchant wallet grows by COD minus fees.
   * **Reports:** the trial balance and balance sheet show green balance checks. Press **Excel** or **PDF** and download the file when it's ready.
   * **Journal:** click any entry to see its debit and credit lines.

Finance roles: `finance@shiply.eg` and `admin@shiply.eg` can act. `ops@shiply.eg` can view finance but not move money.

### Tests

```bash
pnpm test        # shared unit tests + API unit and integration tests (needs Postgres with PostGIS)
pnpm build && pnpm test:e2e   # Playwright smoke tests; reuses running servers or starts the built apps
```

API integration tests create a fresh throwaway database (`shiply_test_<timestamp>`) per run, apply migrations, seed, and drop it afterwards. Set `TEST_OWNER_DB_BASE` / `TEST_APP_DB_BASE` if your Postgres is not on localhost with the default credentials.

Current status: 21 shared tests, 74 API tests (unit + integration, including every posting rule and the full money flow) and 9 Playwright smoke tests pass.
