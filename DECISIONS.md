# Decisions

Choices made where the spec left room, newest phase last. Each one is easy to revisit.

## Phase 1

### Stack
* **ORM: Prisma 6.** Mature migrations and typed client. Prisma 7/8 were release candidates at build time, so 6.19 is pinned. Everything Prisma cannot express (RLS policies, triggers, roles, sequences, PostGIS) lives in hand written SQL migrations (`apps/api/prisma/migrations/*_security`).
* **Validation: zod** schemas in the API instead of class validator decorators.
* **`packages/ui`** was added next to `packages/shared` for React code shared by the merchant portal and the ops dashboard (API client, auth, i18n, orders table, order detail). The driver apps will not use it.
* **Redis, BullMQ and Socket.IO** are in the compose file but not wired in Phase 1 because no background job or live update exists yet. They arrive with the first job (Phase 2 manifests) and live statuses (Phase 4).
* The repository already contained an unrelated Java/Eclipse project (`src/`, `bin/`, `.classpath`). It was left untouched.

### Security and data integrity
* **Two database roles.** Migrations run as the owner. The API connects as `shiply_app`, which owns nothing and has no BYPASSRLS, so RLS always applies. The dev password for `shiply_app` is set in the migration; production must provision the role with its own secret.
* **RLS context** is set per transaction with `set_config('app.merchant_id' | 'app.bypass_rls', …, true)`. Merchant users are pinned to their merchant. Company staff get the bypass flag. Franchise managers and drivers get no bypass yet, so they see nothing merchant owned until their scoped policies arrive (Phases 2 to 4). A query without context sees no merchant rows at all (fail closed).
* **No hard deletes:** DELETE and TRUNCATE are never granted to `shiply_app`. Archiving uses `archived` flags.
* **Append only** `audit_log` and `order_events`: UPDATE revoked plus BEFORE UPDATE/DELETE/TRUNCATE triggers that raise, so even the owner cannot edit them by accident.
* **Frozen prices:** a trigger rejects any change to the fee columns or the pricing snapshot after insert.
* **Bank details lock** ("once every 15 days, enforced in the database"): a trigger reads `merchant.bank_details_lock_days` from `system_config`.
* **Customer success score** across all merchants is computed by a SECURITY DEFINER function that returns only counts, so no other merchant's rows are exposed. Score = delivered / (delivered + returned + unsuccessful + rejected return).
* **Tokens:** access JWT 15 min, refresh token 30 days, random, stored hashed, rotated on every refresh (reuse is rejected). The web apps keep tokens in localStorage for the prototype; moving to httpOnly cookies is recommended before production.
* **App separation:** login requires the target app (`merchant`, `ops`, `pickup`, `delivery`); the role must belong to it and the app is stored in the token. The two driver apps can never share a login.

### Pricing
* Model: `pricing_zone_prices` (pickup zone × destination zone base for Small/Medium Deliver) + `pricing_size_adjustments` (flat add per size) → × order type multiplier (Exchange 1.25 from config, Return 1.00) → × merchant tier multiplier. An exact `pricing_overrides` cell (zone, zone, size, type, tier) wins when present.
* **Seeded placeholders that need business confirmation:** non Cairo prices are 80 EGP + 15 EGP per "zone level" away from Cairo & Giza; size surcharges Large +10, XLarge +20, XXL +35, Light Bulky +60, Heavy Bulky +150 EGP; tiers Bronze 100%, Silver 95%, Gold 90%. All are editable data, not code.
* **COD fee:** 1% applies to the amount above 3,000 EGP (`pricing.cod_fee_mode = excess`). Switch to `full` to charge 1% of the whole COD once above the threshold.
* **VAT** (14%, per merchant toggle) applies to shipping and also to the COD and open package fees (`pricing.vat_applies_to_fees`).
* **Failed delivery charge** (60% of shipping, 48 EGP on 80) is stored excluding VAT; VAT is added when the charge is posted in Phase 5.
* Rounding: integer basis point math, half up. No floats anywhere for money.
* Return orders cannot carry COD.
* Sub accounts inherit the parent merchant's tier.

### Orders
* **Tracking number:** `SHP` + 9 digit sequence + Luhn check digit (prefix configurable). Sequence starts at 1000.
* **Statuses:** the 17 statuses of spec 4.1 grouped exactly as listed. The allowed transitions table is in `packages/shared/src/statuses.ts`. Merchants may only: New → Pending Pickup, New/Pending Pickup → Terminated (cancel), and from Awaiting Merchant Action → reattempt (Assigned to Driver) or return (Returns On Way). Everything else is operational. Concurrent transitions are protected with a compare and set on the current status.
* **Hub detection (Phase 1 only):** geocode → pricing zone (area override or governorate) → nearest hub with `dispatches_last_mile` in the same pricing zone within `zones.max_hub_distance_km` (40). No match → `needs_manual_hub` plus a `MANUAL_HUB_REQUIRED` event (dead zone candidate). Phase 2 replaces this with PostGIS polygons.
* **Mock geocoder:** matches the area and address text against the seeded `areas` table (English, Arabic and keywords, longest match wins), else the governorate centroid. Small deterministic jitter keeps points apart. North Coast is modelled as areas in Matrouh with a `NORTH_COAST` pricing zone override.
* **CSV import:** partial import. Each valid row commits in its own transaction so one bad row never blocks the file; errors are reported per row and field and stored on the `import_batches` row (downloadable CSV). Governorate accepts code, English or Arabic name; sizes accept friendly names; yes/no accepts Arabic. Synchronous up to `orders.csv_max_rows` (2,000); large files move to a BullMQ job later.
* **AWB label:** 4x6 inch PDF, pdfkit + bundled DejaVu Sans. pdfkit has no bidi support, so a small helper splits mixed Arabic/Latin lines into runs and draws them in visual order.
* **Dashboard money until Phase 5:** expected COD = COD of orders not yet final; collected COD = COD of delivered orders. Next cashout date: daily → tomorrow, every 2 days → +2, weekly → next Sunday.

### Testing
* Prisma refuses `migrate reset` when run by an AI agent, so integration tests never reset a shared database. Each run creates its own `shiply_test_<timestamp>` database, runs `migrate deploy`, seeds, and drops only that database at the end.

### Deferred from the Phase 1 list to later phases
* Merchant settings beyond pickup locations and language: logo upload, team member permission editing, TOTP 2FA, API keys with OTP gate, webhook URL, AWB preferences, sub accounts UI. The schema already has `parent_merchant_id`, `permissions` and bank details.
* Order creation via merchant API key (spec 4.5) arrives with API keys.
* Editing pricing tables in the UI (read only view now; values are editable in the database and the 66 `system_config` keys are editable in ops).

## Accounting module (built ahead of Phase 5 on request)

* **Two step COD.** At delivery: Dr Cash with drivers / Cr COD awaiting settlement (2015). At the midnight cash cycle: COD moves from 2015 into the merchant wallet (2010), and the order's frozen fees move from the wallet into revenue and VAT payable. A merchant's money therefore shows as "arriving tonight" until the cycle runs, as the spec's cash cycle describes.
* **Merchant wallet = account 2010 per merchant.** The balance is always derived from ledger rows (credits minus debits) and never stored. "Available to cash out" is the balance minus pending cashouts.
* **Failed delivery charge** is posted when an order becomes Returned or Unsuccessful, at 60% of shipping plus VAT. Whether VAT applies and at what rate is read from the pricing snapshot frozen on the order, not from today's settings. Terminated (cancelled before pickup) orders are not charged.
* **Prepaid orders** (COD 0) still have their fees taken from the wallet, so a wallet can go negative. A negative wallet blocks cashouts until new deliveries bring it back up.
* **Settlement safety:** each order is claimed with `settled_at IS NULL` and posted with idempotency key `settle:<order id>`, so reruns and retries never double count. A unique partial index allows only one RUNNING cash cycle across all API instances (the distributed lock). A run left RUNNING for over an hour is marked failed so the lock cannot stick.
* **Database guarantees:** a deferred constraint trigger rejects any journal whose debits and credits differ (or that has fewer than two lines) at commit. Each line is a positive debit or a positive credit, never both. `journal_entries` and `ledger_entries` are append only. Corrections are REVERSAL journals that mirror the original. Only adjustments and deposits can be reversed by hand, because order money follows the order status.
* **Row level security:** merchants can read only their own ledger lines and cashouts. Only staff can write journals. Deposits, settlement runs and report exports are staff only.
* **Cashouts:**
  * Fees come from `system_config`: bank 15 EGP flat, Fawry 1%, minimum 20 EGP (`merchant.min_cashout_amount`, my default).
  * Requests are serialized per merchant with a row lock so a double click can't overdraw.
  * Approval calls the payout adapter (mock for now) with the cashout id as the idempotency key, then posts Dr Wallet (gross) / Cr Bank (net) / Cr Cashout fee revenue.
  * No VAT on cashout fees by default (`finance.cashout_fee_vat`, not applied yet).
* **Automatic cashouts:** on each merchant's cashout day the cycle opens a bank cashout for the full available balance, when bank details exist and the amount covers the fee. Finance still approves it. Due is measured from the last automatic cashout (1, 2 or 7 days).
* **Cash deposits:** finance records them by hand until the delivery app scans Fawry receipts (Phase 5). The same reference can never be recorded twice (fraud rule 11.2).
* **Reports:** built live from the ledger. Day boundaries follow `finance.timezone` (Africa/Cairo). Exports run as background jobs (BullMQ when `REDIS_URL` is set, otherwise in process) and are stored in `report_exports` for download. Excel amounts are in EGP with two decimals, the only place money is shown as a decimal.
* **Jobs:** BullMQ on Redis. Without `REDIS_URL`, jobs run in process. The tests use that mode and set `REDIS_URL` to an empty string, because Prisma loads `.env` by itself and would otherwise connect the tests to the developer's queue.
* **Financial endpoints** send `Cache-Control: no-store`.
* **Driver earnings and franchise payouts** are not posted yet. Accounts 2030, 2040, 5010 and 5020 exist for Phase 5.

## Operations from the portal (driver apps postponed on request)

* **One place for status changes.** Every status change, including bulk actions, goes through `OrdersService.transitionInTx`. It checks the transitions table, applies operational fields (driver, current hub, attempts, failure reason) in the same update, and writes the order event, money postings and audit row. Bulk actions run one transaction per order and report which orders failed and why, so one bad parcel never blocks a batch.
* **Drivers** are a `drivers` profile plus a login user with the PICKUP_DRIVER or DELIVERY_DRIVER role, ready for the apps later. New drivers get a random password; only the seed sets the demo password.
* **Order location** is tracked in `current_hub_id`. Receiving a scan decides the next status from the current status and the hub's two toggles. Parcels coming back from a driver after a failed attempt keep their Awaiting Merchant Action status and only update their location.
* **Transfers** are manifests (`transfers`, `transfer_items`). Scan out requires the parcel to be at the origin hub. Dispatch moves parcels to In Transfer, or to Returns On Way for returns going to the sorting facility. The last scan in completes the transfer automatically. Closing it early raises a MISSING_SCAN_IN alert per missing parcel. A job every 15 minutes flags transfers still in transit after 3 hours plus `hubs.missing_scan_alert_minutes`.
* **Run sheets** use the in house routing: nearest neighbour from the driver's hub, straight line distance times `routing.road_factor_bp`, `routing.average_speed_kmh`, plus `routing.stop_buffer_minutes` per stop. ETAs assume a 09:00 start. Google Directions stays a later fallback.
* **COD per driver:** the ledger now has a `driver_id` dimension. Delivered COD is debited to Cash with drivers against the assigned driver, so each driver's expected handover always comes from the books.
* **End of day handover:** Dr Cash in hub safes (1040, received), Dr Driver shortages receivable (1050, any shortage, on that driver), Cr Cash with drivers (expected); an overage is credited to other income. Any difference raises an alert, HIGH above `fraud.deposit_tolerance_bp` (5%). A shortage repayment is Dr 1040 / Cr 1050.
* **Deposits:** new kinds move hub safe cash to the bank or Fawry. Driver deposit kinds now require a driver and cannot exceed what that driver holds.
* **Alerts table** is shared by operations and fraud checks. There is one open alert per kind and entity, resolved with a note that is audited.
* **Maintenance note:** `prisma migrate diff` does not know about hand written constraints (for example `ledger_account_fk`). Generated migrations must be checked and those DROP lines removed, as was done in the operations migration.
