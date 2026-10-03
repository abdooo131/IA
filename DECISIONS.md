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
