# Merchants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The merchants module: one merchant record for both services, sign ups, merchant logins, versioned contracts with prices for both services that go live only after a second person approves, pricing zones, the product catalog, and the office Merchants app.

**Architecture:** Module `merchants` with its own PostgreSQL schema. Other modules ask `MerchantsService` (public `index.ts`) for a merchant and for a price; they never read its tables. The pickup address is placed through `LocationService.resolve`. Sales "Won" (a later module) will call `MerchantsService.createFromDeal`.

**Tech Stack:** as before.

**Spec:** `shiply/docs/UI.md` Step 3b (Merchants app), `shiply/docs/MERCHANT_PORTAL.md` (sizes, order types, fees), `shiply/docs/TECH.md` section 3; owner decisions of 2026-11-09 below.

## Global Constraints

- Everything in the Foundation and Location plans' constraints still applies.
- Owner decisions: parcel prices are per **pricing zone** (bigger than delivery zones, made of governorates) × **size** (`small`, `medium`, `large`, `light_bulky`, `heavy_bulky`); a contract version goes live only after a **second person with Sales manage** approves it, never its author.
- Money in piastres; percentages in basis points (1% = 100 bp).
- Contract versions: `draft` → `pending` → `active` → `superseded`; `pending` → `rejected` (back to editable as a new draft). One `active` version per contract at a time; activation and superseding happen in one transaction.
- Cheques, ledger and payouts stay in Accounting; deals and proposals stay in Sales; stock stays in Shiply Now.
- Access: `merchants` view to see, use to edit merchants, products and drafts, manage to approve sign ups; contract approval needs `sales` manage.

## Review Focus

1. Two people approving the same pending version at once: one activates it, the other is told.
2. The author of a version approving it (directly or through a second login of the same user): refused.
3. A price asked for a parcel to a governorate in no pricing zone, or a size with no price: a clear `no_price` answer, never zero.
4. A merchant code or SKU typed with different case or spaces (`EVE`, ` eve `): one merchant, one SKU.
5. Deactivating a merchant with an active contract: logins stop, the contract stays for history.

---

### Task 1: Schema

**Files:** `packages/db/prisma/schema.prisma` (schema `merchants`), migration, `packages/db/test/seed.test.ts` (truncate list), API and e2e test resets.

**Interfaces (models, schema `merchants`):**
- `Merchant(id cuid, code unique, name, legalName?, logoUrl?, contactName, contactPhone, contactEmail?, billingEmails String[], emailLanguage 'ar'|'en', taxNumber?, taxGovernorate?, taxCity?, taxStreet?, taxBuilding?, bankName?, bankAccount?, iban?, beneficiary?, accountManagerId?, pickupAddress?, pickupPlaceId?, pickupDecisionId?, services String[] ('shiply_now','shiply'), status 'pending'|'approved'|'rejected'|'inactive', rejectReason?, flexShip Boolean, createdAt, updatedAt)`
- `MerchantUser(userId @id, merchantId, role 'owner'|'staff')`
- `PricingZone(id cuid, code unique, nameEn, nameAr, active)`, `PricingZoneArea(placeId @id, pricingZoneId)` (governorate place ids)
- `Contract(id cuid, merchantId unique, number unique)`
- `ContractVersion(id cuid, contractId, version Int, status, startDate, endDate?, noticeDays, payoutSchedule 'weekly'|'twice_weekly'|'daily', minimumPayout, minimumMonthlyFee, securityDeposit, creditLimit, now fields: deliveryFee, orderFixed, orderPercentBp, codPercentBp, failedDeliveryFee, receivingPerUnit, storagePerUnitMonth, returnPerUnit, packagingCharge, promiseMinutes; parcel fields: codFeeBp, returnFeeBp, openPackageFee, deliveryAttempts; terms?, internalNote?, createdById, submittedAt?, approvedById?, approvedAt?, rejectedById?, rejectReason?)`, unique (contractId, version)
- `ParcelPrice(versionId, pricingZoneId, size, price)` id (versionId, pricingZoneId, size)
- `VolumeTier(versionId, minParcels, discountBp)` id (versionId, minParcels)
- `Product(id cuid, merchantId, sku, barcode?, nameEn, nameAr, price, weightGrams?, shopifyVariantId?, active)`, unique (merchantId, sku)
- `ShopifyShop(id cuid, merchantId, domain unique, status 'connected'|'disconnected', connectedAt)`

- [ ] Steps: seed test asserts the schema exists (truncate works, `merchant.count()` is 0) → FAIL → schema and migration → PASS → commit `feat(merchants): schema`.

### Task 2: Merchants, sign ups and merchant logins (API)

**Files:** `apps/api/src/merchants/{index.ts, merchants.module.ts, merchants.service.ts, merchants.controller.ts}`; test `apps/api/test/merchants.test.ts`

**Interfaces:**
- Public: `MerchantsService.get(id)`, `MerchantsService.createFromDeal(tx, input)` (status `approved`).
- Routes: `GET /merchants?q&status&service&page`; `GET /merchants/:id`; `POST /merchants` (use; code from the name, upper case, unique, e.g. `EVE`, `EVE2`); `PATCH /merchants/:id` (use); `POST /merchants/:id/approve` and `/reject {reason}` (manage; only from `pending`); `POST /merchants/:id/deactivate` (manage; its users can no longer sign in); `POST /merchants/:id/users {name, nameAr, email|mobile, password, role}` (use; creates a platform user of kind `merchant_user` with no office app access); `GET /merchants/signups` (pending, oldest first).
- Pickup address: on create or change, `LocationService.resolve(tx, {service: 'shiply', refType: 'merchant_pickup', refId: merchant.id, text})` and store `pickupPlaceId` (null when queued) and `pickupDecisionId`; a later `location.resolved` event for `merchant_pickup` fills `pickupPlaceId`.
- Home: attention `merchants.signupsWaiting` for merchants manage; tile count = pending sign ups.

- [ ] Tests: create twice with names "Eve Chantelle" and "eve chantelle" → codes `EVE` and `EVE2`; pickup `شارع 9 المعادي الجديدة` → `pickupPlaceId 'new-maadi'`; unclear pickup → queued, then a pick fills it through the event; approve a pending sign up → approved, approving again → 409; a merchant user signs in and `GET /me` shows every office app at `none`; deactivate → that user's sign in answers 401; viewer `POST /merchants` → 403.
- [ ] RED → implement → GREEN → commit `feat(merchants): merchants, sign ups and merchant logins`.

### Task 3: Contracts, pricing zones and prices (API)

**Files:** `apps/api/src/merchants/{contracts.service.ts, contracts.controller.ts, pricing.ts}`; test `apps/api/test/contracts.test.ts`

**Interfaces:**
- Routes: pricing zones `GET/POST/PATCH /merchants/pricing-zones`, `PUT /merchants/pricing-zones/:id/areas {placeIds}` (governorates only; a governorate in one zone only);
  contracts `GET /merchants/:id/contract` (all versions); `POST /merchants/:id/contract/drafts` (use; copies the active version or starts empty); `PATCH /merchants/contract-versions/:id` (use; draft only; prices and tiers replaced as sent); `POST .../:id/submit` (draft → pending); `POST .../:id/approve` (sales manage; not the author; pending → active, previous active → superseded, one transaction; second approve → 409); `POST .../:id/reject {reason}` (sales manage; pending → rejected); `GET /merchants/contracts/pending` (list for approvers).
- Public: `MerchantsService.parcelPrice(merchantId, {destinationPlaceId, size, monthParcels}) → {price, zone, discountBp} | {error: 'no_price'}`: the governorate above the destination (through `@shiply/address` chain over the places) → its pricing zone → the active version's price for that size, less the highest volume tier at or under `monthParcels`.
- Home: attention `merchants.contractsWaiting` for sales manage.

- [ ] Tests: draft → submit → approve by the author → 403 `{error:'own_version'}`; approve by another sales manager → active, previous superseded; two approvals at once → 200 and 409; price for `new-maadi`, `medium`, 1,200 parcels with a Greater Cairo price of 5,000 piastres and a tier of 1,000 parcels at 500 bp → 4,750; a destination in Alexandria with no zone → `no_price`; a governorate put in a second zone → 409.
- [ ] RED → implement → GREEN → commit `feat(merchants): contracts, pricing zones and prices`.

### Task 4: Products and Shopify shops (API)

**Files:** `apps/api/src/merchants/products.controller.ts`; test `apps/api/test/products.test.ts`

**Interfaces:** `GET /merchants/:id/products?q&active&page`; `POST` (use; SKU trimmed, upper case, unique per merchant → 409 `sku_taken`); `PATCH /merchants/products/:id`; `POST /merchants/:id/products/import {csv}` (columns sku, barcode, name_en, name_ar, price, weight_grams; reports created, updated, refused rows with reasons); `GET/POST /merchants/:id/shopify` (record a shop domain; the live connection comes with the order modules).

- [ ] Tests: ` eve-01 ` and `EVE-01` → one SKU, second create 409; import of 3 rows with one bad price → 2 created, 1 refused with its row number; price `12.50` stored as 1250.
- [ ] RED → implement → GREEN → commit `feat(merchants): products and Shopify shops`.

### Task 5: Merchants app (office screens)

**Files:** `apps/web/src/app/[locale]/(shell)/merchants/{menu.ts, page.tsx, list/page.tsx, [id]/page.tsx, new/page.tsx, signups/page.tsx, contracts/page.tsx, contracts/[versionId]/page.tsx, shopify/page.tsx, packaging/page.tsx}`, `apps/web/e2e/merchants.spec.ts`, texts.

- Menu (UI.md Step 3b): `Merchants  Sign ups  Contracts  Shopify stores  Packaging orders`. Packaging orders shows "Comes with Purchasing".
- Merchant record tabs: Overview (contact, account manager, pickup with its area), Shiply Now and Shiply (the services and their settings), Contract and prices (versions with status; open the draft), Money ("Comes with Accounting"), Users (merchant logins, add), Integrations (Shopify shops), Documents ("Comes with file storage").
- Contract version page: Shiply Now fees, parcel price grid (pricing zones × 5 sizes), volume tiers, money terms; Submit; Approve and Reject for Sales managers who are not the author.
- Contracts page: tabs Pending approval, Pricing zones (zones and their governorates).

- [ ] Playwright: create a merchant with a pickup address → record shows "Cairo › Maadi › New Maadi"; add a draft, fill a price, submit; as the author the Approve button is absent; a second admin approves → status Active; Sign ups shows a pending merchant and Approve moves it out; a merchant user created from Users cannot open `/en/merchants` (no access page).
- [ ] RED → implement → GREEN; full suite and lint → commit `feat(merchants): merchants app` and push.

---

**Done when:** the Merchants tile opens the five pages; merchants, logins, contracts with second person approval, pricing zones, prices and products work end to end; all tests pass.

**Not in this plan:** the merchant portal screens (its own plan, from MERCHANT_PORTAL.md), live Shopify sync, documents upload, packaging orders, money tab (Accounting).
